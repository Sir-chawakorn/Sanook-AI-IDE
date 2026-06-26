/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
(function () {
	const vscode = acquireVsCodeApi();
	const messagesEl = document.getElementById('messages');
	const setupEl = document.getElementById('setup');
	const composerEl = document.getElementById('composer');
	const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
	const sendBtn = document.getElementById('send');
	const modelSel = /** @type {HTMLSelectElement} */ (document.getElementById('model'));

	/** @type {{ content: HTMLElement, thought: HTMLElement, tools: HTMLElement, text: string, thoughtText: string } | null} */
	let current = null;
	let busy = false;

	// ---- minimal markdown (escape first, then transform; safe for innerHTML) ----
	function escapeHtml(s) {
		return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
	}
	function renderMarkdown(src) {
		const blocks = [];
		// Pull fenced code blocks out behind an ASCII sentinel so inline rules don't touch them.
		let t = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
			blocks.push('<pre class="code"><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
			return '@@CB' + (blocks.length - 1) + '@@';
		});
		t = escapeHtml(t);
		t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
		t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
		t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
		t = t.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _h, txt) => '<div class="md-h">' + txt + '</div>');
		t = t.replace(/^\s*[-*]\s+(.+)$/gm, '<div class="md-li">\u2022 $1</div>');
		t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
		t = t.replace(/\n/g, '<br>');
		t = t.replace(/@@CB(\d+)@@/g, (_m, i) => blocks[+i]);
		return t;
	}

	function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

	function addMessage(role, text) {
		const el = document.createElement('div');
		el.className = 'msg ' + role;
		const content = document.createElement('div');
		content.className = 'content';
		if (role === 'assistant') { content.innerHTML = renderMarkdown(text); } else { content.textContent = text; }
		el.appendChild(content);
		messagesEl.appendChild(el);
		scrollToBottom();
	}

	function startAssistant() {
		const el = document.createElement('div');
		el.className = 'msg assistant';
		const thought = document.createElement('div'); thought.className = 'thought hidden';
		const tools = document.createElement('div'); tools.className = 'tools';
		const content = document.createElement('div'); content.className = 'content';
		el.appendChild(thought); el.appendChild(tools); el.appendChild(content);
		messagesEl.appendChild(el);
		current = { content, thought, tools, text: '', thoughtText: '' };
		scrollToBottom();
	}

	function setBusy(b) {
		busy = b;
		sendBtn.textContent = b ? '\u25A0' : '\u2191'; // filled square while busy, up arrow otherwise
		sendBtn.title = b ? 'Stop' : 'Send';
		sendBtn.classList.toggle('stop', b);
	}

	function showSetup(state) {
		setupEl.classList.remove('hidden');
		messagesEl.classList.add('hidden');
		composerEl.classList.add('hidden');
		const needsSetup = state === 'needs_setup';
		setupEl.innerHTML = '';
		const card = document.createElement('div'); card.className = 'setup-card';
		const title = document.createElement('h3');
		title.textContent = needsSetup ? 'Hermes needs setup' : 'Hermes is not installed';
		const body = document.createElement('p');
		body.textContent = needsSetup
			? 'Hermes is installed but not configured yet (no model or credentials). Run setup to pick a model and sign in.'
			: 'Hermes is not installed. Install it, then reload the window:';
		card.appendChild(title);
		card.appendChild(body);
		if (!needsSetup) {
			const code = document.createElement('pre');
			code.textContent = 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash';
			card.appendChild(code);
		}
		const btn = document.createElement('button'); btn.className = 'primary';
		btn.textContent = needsSetup ? 'Run Hermes setup' : 'Open setup in terminal';
		btn.addEventListener('click', () => vscode.postMessage({ type: 'runSetup' }));
		card.appendChild(btn);
		setupEl.appendChild(card);
	}

	function showChat() {
		setupEl.classList.add('hidden');
		messagesEl.classList.remove('hidden');
		composerEl.classList.remove('hidden');
		input.focus();
	}

	function populateModels(payload) {
		modelSel.innerHTML = '';
		let count = 0;
		const current = payload && payload.current;
		if (payload && Array.isArray(payload.groups) && payload.groups.length) {
			// Category-grouped: one <optgroup> per provider.
			for (const g of payload.groups) {
				const og = document.createElement('optgroup');
				og.label = g.label;
				for (const m of g.models) {
					const opt = document.createElement('option');
					opt.value = m.id; opt.textContent = m.name || m.id;
					if (m.id === current) { opt.selected = true; }
					og.appendChild(opt); count++;
				}
				modelSel.appendChild(og);
			}
		} else if (payload && Array.isArray(payload.models)) {
			for (const m of payload.models) {
				const opt = document.createElement('option');
				opt.value = m.id; opt.textContent = m.name || m.id;
				if (m.description) { opt.title = m.description; }
				if (m.id === current) { opt.selected = true; }
				modelSel.appendChild(opt); count++;
			}
		}
		if (!count) { modelSel.classList.add('hidden'); return; }
		modelSel.classList.remove('hidden');
	}

	window.addEventListener('message', e => {
		const m = e.data;
		switch (m.type) {
			case 'status': m.state === 'ready' ? showChat() : showSetup(m.state); break;
			case 'clear': messagesEl.innerHTML = ''; current = null; setBusy(false); break;
			case 'models': populateModels(m); break;
			case 'system': addMessage('system', m.text); break;
			case 'userMessage': addMessage('user', m.text); break;
			case 'assistantStart': startAssistant(); setBusy(true); break;
			case 'chunk':
				if (!current) { startAssistant(); }
				current.text += m.text; current.content.innerHTML = renderMarkdown(current.text); scrollToBottom();
				break;
			case 'thought':
				if (!current) { startAssistant(); }
				current.thoughtText += m.text; current.thought.textContent = current.thoughtText;
				current.thought.classList.remove('hidden'); scrollToBottom();
				break;
			case 'tool':
				if (current) {
					const t = document.createElement('div'); t.className = 'tool';
					t.textContent = '\u{1F527} ' + m.title; current.tools.appendChild(t); scrollToBottom();
				}
				break;
			case 'done': current = null; setBusy(false); break;
			case 'error': addMessage('error', '\u26A0 ' + m.message); current = null; setBusy(false); break;
		}
	});

	function send() {
		if (busy) { vscode.postMessage({ type: 'cancel' }); return; }
		const text = input.value.trim();
		if (!text) { return; }
		input.value = '';
		autoGrow();
		vscode.postMessage({ type: 'send', text });
	}

	function autoGrow() {
		input.style.height = 'auto';
		input.style.height = Math.min(input.scrollHeight, 200) + 'px';
	}

	sendBtn.addEventListener('click', send);
	input.addEventListener('input', autoGrow);
	input.addEventListener('keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
	});
	modelSel.addEventListener('change', () => vscode.postMessage({ type: 'setModel', modelId: modelSel.value }));

	vscode.postMessage({ type: 'ready' });
})();
