/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// #region Agent Client Protocol (ACP) connection — NDJSON JSON-RPC 2.0 over the
// `hermes acp` child process stdio. Mirrors the framing used by the codex
// app-server client; ported here so the extension host owns its own bridge.

class HermesAcpConnection {
	/** @param {import('child_process').ChildProcessWithoutNullStreams} child */
	constructor(child) {
		this._child = child;
		this._nextId = 1;
		/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void}>} */
		this._pending = new Map();
		/** @type {Map<string, (params:any)=>void>} */
		this._notify = new Map();
		/** @type {Map<string, (params:any)=>Promise<any>|any>} */
		this._requestHandlers = new Map();
		this._buf = '';
		this._exited = false;

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', chunk => this._onData(chunk));
		child.on('exit', (code) => {
			this._exited = true;
			for (const p of this._pending.values()) { p.reject(new Error(`hermes acp exited (code=${code})`)); }
			this._pending.clear();
		});
	}

	_onData(chunk) {
		this._buf += chunk;
		let nl;
		while ((nl = this._buf.indexOf('\n')) >= 0) {
			const line = this._buf.slice(0, nl).trim();
			this._buf = this._buf.slice(nl + 1);
			if (!line) { continue; }
			let msg;
			try { msg = JSON.parse(line); } catch { continue; }
			this._dispatch(msg);
		}
	}

	_dispatch(msg) {
		if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && msg.method === undefined) {
			const p = this._pending.get(msg.id);
			if (!p) { return; }
			this._pending.delete(msg.id);
			if (msg.error) { p.reject(new Error(msg.error.message || 'JSON-RPC error')); }
			else { p.resolve(msg.result); }
			return;
		}
		if (msg.method && msg.id !== undefined) { this._handleServerRequest(msg); return; }
		if (msg.method) {
			const h = this._notify.get(msg.method);
			if (h) { try { h(msg.params); } catch { /* ignore */ } }
		}
	}

	async _handleServerRequest(msg) {
		const handler = this._requestHandlers.get(msg.method);
		if (!handler) { this._write({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } }); return; }
		try { const result = await handler(msg.params); this._write({ id: msg.id, result }); }
		catch (e) { this._write({ id: msg.id, error: { code: -32603, message: String((e && e.message) || e) } }); }
	}

	_write(obj) {
		if (this._exited) { return; }
		try { this._child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* closed */ }
	}

	request(method, params) {
		if (this._exited) { return Promise.reject(new Error('hermes acp is not running')); }
		const id = this._nextId++;
		return new Promise((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			const payload = { id, method };
			if (params !== undefined) { payload.params = params; }
			this._write(payload);
		});
	}

	notify(method, params) {
		const payload = { method };
		if (params !== undefined) { payload.params = params; }
		this._write(payload);
	}

	onNotification(method, handler) { this._notify.set(method, handler); }
	onRequest(method, handler) { this._requestHandlers.set(method, handler); }

	dispose() {
		try { this._child.stdin.end(); } catch { /* closed */ }
		const t = setTimeout(() => { try { this._child.kill('SIGKILL'); } catch { /* dead */ } }, 2000);
		this._child.once('exit', () => clearTimeout(t));
	}
}

// #endregion

// #region Detection + process

function resolveBinary() {
	return process.env.HERMES_BIN || path.join(os.homedir(), '.local', 'bin', 'hermes');
}

/** @returns {{state:'not_installed'|'needs_setup'|'ready'}} */
function checkStatus() {
	const bin = resolveBinary();
	const home = path.join(os.homedir(), '.hermes');
	const binaryFound = fs.existsSync(bin) || (!bin.includes('/') && fs.existsSync(home));
	if (!binaryFound) { return { state: 'not_installed' }; }
	const hasConfig = fs.existsSync(path.join(home, 'config.yaml'));
	const hasCreds = fs.existsSync(path.join(home, 'auth.json')) || fs.existsSync(path.join(home, '.env'));
	if (!hasConfig || !hasCreds) { return { state: 'needs_setup' }; }
	return { state: 'ready' };
}

function spawnHermes() {
	const env = Object.assign({}, process.env);
	delete env.PYTHONPATH; delete env.PYTHONHOME; delete env.VIRTUAL_ENV; delete env.ELECTRON_RUN_AS_NODE;
	return cp.spawn(resolveBinary(), ['acp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
}

// #endregion

class HermesViewProvider {
	/** @param {vscode.ExtensionContext} context */
	constructor(context) {
		this._context = context;
		/** @type {HermesAcpConnection|null} */
		this._conn = null;
		this._sessionId = null;
		this._initialized = false;
		this._busy = false;
		/** @type {vscode.WebviewView|undefined} */
		this._view = undefined;
	}

	/** @param {vscode.WebviewView} view */
	resolveWebviewView(view) {
		this._view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')],
		};
		view.webview.html = this._html(view.webview);
		view.webview.onDidReceiveMessage(m => this._onMessage(m));
		view.onDidDispose(() => this._resetConnection());
	}

	_post(msg) { if (this._view) { this._view.webview.postMessage(msg); } }

	_resetConnection() {
		if (this._conn) { this._conn.dispose(); }
		this._conn = null;
		this._sessionId = null;
		this._initialized = false;
		this._busy = false;
	}

	async _onMessage(m) {
		switch (m && m.type) {
			case 'ready': this._post({ type: 'status', state: checkStatus().state }); break;
			case 'runSetup': vscode.commands.executeCommand('hermes.runSetup'); break;
			case 'newSession': this._resetConnection(); this._post({ type: 'clear' }); this._post({ type: 'status', state: checkStatus().state }); break;
			case 'send': await this._send(String(m.text || '')); break;
			case 'cancel': this._cancel(); break;
			case 'setModel': await this._setModel(String(m.modelId || '')); break;
		}
	}

	_cancel() {
		if (this._conn && this._sessionId) {
			this._conn.notify('session/cancel', { sessionId: this._sessionId });
		}
	}

	async _setModel(modelId) {
		if (!modelId || !this._conn || !this._sessionId) { return; }
		try {
			await this._conn.request('session/set_model', { sessionId: this._sessionId, modelId });
			this._post({ type: 'system', text: 'Switched model → ' + modelId });
		} catch (e) {
			this._post({ type: 'error', message: 'Could not switch model: ' + String((e && e.message) || e) });
		}
	}

	/** Resolve which providers currently have credentials, via `hermes auth list`. */
	_authedProviders() {
		return new Promise(resolve => {
			try {
				const env = Object.assign({}, process.env);
				delete env.PYTHONPATH; delete env.PYTHONHOME; delete env.VIRTUAL_ENV; delete env.ELECTRON_RUN_AS_NODE;
				cp.execFile(resolveBinary(), ['auth', 'list'], { env, timeout: 8000 }, (err, stdout) => {
					if (err || !stdout) { resolve(null); return; }
					const set = new Set();
					for (const line of String(stdout).split('\n')) {
						const match = /^([a-z][a-z0-9-]+)\s+\(\d+\s+credential/.exec(line);
						if (match) { set.add(match[1]); }
					}
					resolve(set.size ? set : null);
				});
			} catch { resolve(null); }
		});
	}

	/**
	 * Build a category-grouped model list from Hermes' provider model cache,
	 * limited to providers that actually have credentials. Returns null if the
	 * cache can't be read (caller falls back to the ACP availableModels list).
	 */
	async _loadGroupedModels() {
		try {
			const cachePath = path.join(os.homedir(), '.hermes', 'provider_models_cache.json');
			const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
			const authed = await this._authedProviders();
			const LABELS = { 'openai-codex': 'OpenAI Codex', 'xai-oauth': 'xAI Grok', 'copilot': 'GitHub Copilot', 'anthropic': 'Anthropic', 'openrouter': 'OpenRouter' };
			const ORDER = ['openai-codex', 'xai-oauth', 'copilot', 'anthropic'];
			const rank = p => { const i = ORDER.indexOf(p); return i < 0 ? 99 : i; };
			const groups = [];
			for (const prov of Object.keys(raw).sort((a, b) => rank(a) - rank(b))) {
				if (authed && !authed.has(prov)) { continue; }
				const models = (raw[prov] && Array.isArray(raw[prov].models)) ? raw[prov].models : [];
				if (!models.length) { continue; }
				groups.push({ label: LABELS[prov] || prov, models: models.map(name => ({ id: prov + ':' + name, name })) });
			}
			return groups.length ? groups : null;
		} catch { return null; }
	}

	async _ensureSession() {
		if (!this._conn) {
			const child = spawnHermes();
			child.on('error', e => this._post({ type: 'error', message: `Failed to start hermes: ${e.message}` }));
			child.stderr.setEncoding('utf8');
			child.stderr.on('data', () => { /* logs ignored in UI */ });
			this._conn = new HermesAcpConnection(child);
			this._conn.onNotification('session/update', p => this._onUpdate(p));
			// Answer agent-initiated fs reads/writes from disk (M1: no dirty-buffer awareness).
			this._conn.onRequest('fs/read_text_file', async params => {
				try { return { content: fs.readFileSync(params.path, 'utf8') }; } catch (e) { throw new Error(String(e.message || e)); }
			});
			this._conn.onRequest('fs/write_text_file', async params => {
				fs.writeFileSync(params.path, params.content, 'utf8'); return null;
			});
		}
		if (!this._initialized) {
			await this._conn.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false } });
			this._initialized = true;
		}
		if (!this._sessionId) {
			const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
			const cwd = folder ? folder.uri.fsPath : os.homedir();
			const r = await this._conn.request('session/new', { cwd, mcpServers: [] });
			this._sessionId = r && r.sessionId;
			const models = r && r.models;
			const current = models && models.currentModelId;
			const groups = await this._loadGroupedModels();
			if (groups) {
				this._post({ type: 'models', groups, current });
			} else if (models && Array.isArray(models.availableModels)) {
				this._post({
					type: 'models',
					models: models.availableModels.map(mm => ({ id: mm.modelId, name: mm.name || mm.modelId, description: mm.description })),
					current,
				});
			}
		}
		return this._sessionId;
	}

	_onUpdate(p) {
		if (!p || p.sessionId !== this._sessionId || !p.update) { return; }
		const u = p.update;
		if (u.sessionUpdate === 'agent_message_chunk' && u.content && u.content.type === 'text') {
			this._post({ type: 'chunk', text: u.content.text });
		} else if (u.sessionUpdate === 'agent_thought_chunk' && u.content && u.content.type === 'text') {
			this._post({ type: 'thought', text: u.content.text });
		} else if (u.sessionUpdate === 'tool_call') {
			this._post({ type: 'tool', title: (u.title || u.kind || 'tool') });
		}
	}

	async _send(text) {
		if (this._busy || !text.trim()) { return; }
		const status = checkStatus();
		if (status.state !== 'ready') { this._post({ type: 'status', state: status.state }); return; }
		this._busy = true;
		this._post({ type: 'userMessage', text });
		this._post({ type: 'assistantStart' });
		try {
			const sid = await this._ensureSession();
			await this._conn.request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text }] });
		} catch (e) {
			this._post({ type: 'error', message: String((e && e.message) || e) });
		} finally {
			this._busy = false;
			this._post({ type: 'done' });
		}
	}

	_html(webview) {
		const nonce = crypto.randomBytes(16).toString('hex');
		const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.css'));
		const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js'));
		return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${cssUri}"></head>
<body>
	<div id="setup" class="hidden"></div>
	<div id="messages"></div>
	<div id="composer">
		<div id="composer-row">
			<textarea id="input" rows="1" placeholder="Message Hermes…"></textarea>
			<button id="send" title="Send">↑</button>
		</div>
		<div id="composer-footer">
			<select id="model" title="Model" class="hidden"></select>
		</div>
	</div>
	<script nonce="${nonce}" src="${jsUri}"></script>
</body></html>`;
	}
}

function activate(context) {
	// The Sanook fork supports the secondary sidebar, so the view lives there.
	vscode.commands.executeCommand('setContext', 'hermes:doesNotSupportSecondarySidebar', false);

	const provider = new HermesViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('hermes.chatView', provider, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.registerWebviewViewProvider('hermes.chatViewSecondary', provider, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('hermes.runSetup', () => {
			const term = vscode.window.createTerminal('Hermes Setup');
			term.show();
			term.sendText('hermes setup');
		}),
		vscode.commands.registerCommand('hermes.newSession', () => provider._onMessage({ type: 'newSession' })),
	);
}

function deactivate() { }

module.exports = { activate, deactivate };
