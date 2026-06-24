/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import {
	HERMES_ACP_PROTOCOL_VERSION,
	HermesContentBlock,
	IHermesAcpService,
	IHermesInitializeResult,
	IHermesPromptResult,
	IHermesSessionUpdate,
	IHermesSessionUpdateEvent,
} from '../common/hermesAcp.js';
import { HermesAcpConnection, transportFromChildProcess } from './hermesAcpConnection.js';

/**
 * Node-layer implementation of {@link IHermesAcpService}. Owns the
 * `hermes acp` child process and a single {@link HermesAcpConnection},
 * multiplexing every window session over ACP `sessionId`s.
 */
export class HermesAcpService extends Disposable implements IHermesAcpService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidReceiveSessionUpdate = this._register(new Emitter<IHermesSessionUpdateEvent>());
	readonly onDidReceiveSessionUpdate = this._onDidReceiveSessionUpdate.event;

	private readonly _onDidExit = this._register(new Emitter<{ readonly code: number | null; readonly signal: string | null }>());
	readonly onDidExit = this._onDidExit.event;

	private readonly _connection = this._register(new MutableDisposable<HermesAcpConnection>());
	private _initializePromise: Promise<IHermesInitializeResult> | undefined;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	initialize(binaryPath?: string): Promise<IHermesInitializeResult> {
		if (!this._initializePromise) {
			this._initializePromise = this._doInitialize(binaryPath).catch(err => {
				// Allow a later retry after a failed spawn/handshake.
				this._initializePromise = undefined;
				throw err;
			});
		}
		return this._initializePromise;
	}

	private async _doInitialize(binaryPath?: string): Promise<IHermesInitializeResult> {
		const bin = this._resolveBinary(binaryPath);
		this._logService.info(`[hermes-acp] spawning: ${bin} acp`);

		const env: NodeJS.ProcessEnv = { ...process.env };
		// Hermes is a bash wrapper around its own venv; never leak VS Code's
		// Python environment into it.
		delete env.PYTHONPATH;
		delete env.PYTHONHOME;
		delete env.VIRTUAL_ENV;
		delete env.ELECTRON_RUN_AS_NODE;

		const child = spawn(bin, ['acp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });

		child.on('error', err => this._logService.error(`[hermes-acp] spawn error: ${err.message}`));
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			for (const line of chunk.split('\n')) {
				if (line.trim().length > 0) {
					this._logService.info(`[hermes-acp:stderr] ${line}`);
				}
			}
		});

		const connection = new HermesAcpConnection(
			transportFromChildProcess(child),
			(level, message) => this._logService[level](`[hermes-acp] ${message}`),
		);
		this._connection.value = connection;

		this._register(connection.onExit(e => {
			this._logService.info(`[hermes-acp] exited code=${e.code} signal=${e.signal}`);
			this._initializePromise = undefined;
			this._onDidExit.fire({ code: e.code, signal: e.signal });
		}));

		// Stream all `session/update` notifications out to subscribers.
		connection.onNotification('session/update', params => {
			const p = params as { sessionId?: string; update?: IHermesSessionUpdate } | undefined;
			if (p && typeof p.sessionId === 'string' && p.update) {
				this._onDidReceiveSessionUpdate.fire({ sessionId: p.sessionId, update: p.update });
			}
		});

		const result = await connection.request<IHermesInitializeResult>('initialize', {
			protocolVersion: HERMES_ACP_PROTOCOL_VERSION,
			clientCapabilities: {
				fs: { readTextFile: true, writeTextFile: true },
				terminal: false,
			},
		});
		this._logService.info(`[hermes-acp] initialized (protocolVersion=${result?.protocolVersion})`);
		return result;
	}

	private _connectionOrThrow(): HermesAcpConnection {
		const connection = this._connection.value;
		if (!connection) {
			throw new Error('Hermes ACP connection is not initialized');
		}
		return connection;
	}

	async newSession(cwd: string): Promise<{ readonly sessionId: string }> {
		await this.initialize();
		const result = await this._connectionOrThrow().request<{ sessionId: string }>('session/new', { cwd, mcpServers: [] });
		return { sessionId: result.sessionId };
	}

	async prompt(sessionId: string, blocks: readonly HermesContentBlock[]): Promise<IHermesPromptResult> {
		const result = await this._connectionOrThrow().request<IHermesPromptResult>('session/prompt', { sessionId, prompt: blocks });
		return { stopReason: result?.stopReason ?? 'end_turn' };
	}

	async cancel(sessionId: string): Promise<void> {
		this._connection.value?.notify('session/cancel', { sessionId });
	}

	private _resolveBinary(binaryPath?: string): string {
		return binaryPath || process.env.HERMES_BIN || join(homedir(), '.local', 'bin', 'hermes');
	}
}
