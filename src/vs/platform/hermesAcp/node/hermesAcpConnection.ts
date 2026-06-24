/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Readable, Writable } from 'stream';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, type IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { hasKey } from '../../../base/common/types.js';

/**
 * Generic JSON-RPC 2.0 client over newline-delimited JSON (NDJSON) on a child
 * process's stdio. This is the Agent Client Protocol (ACP) transport for the
 * `hermes acp` process. Framing is identical to the codex app-server client
 * (`platform/agentHost/node/codex/codexAppServerClient.ts`); this is a
 * domain-agnostic port — the {@link HermesAcpService} above maps it onto ACP
 * semantics.
 */

/** Standard JSON-RPC error codes. @see https://www.jsonrpc.org/specification#error_object */
export const enum JsonRpcErrorCode {
	ParseError = -32700,
	InvalidRequest = -32600,
	MethodNotFound = -32601,
	InvalidParams = -32602,
	InternalError = -32603,
}

/** Error thrown when a remote request responds with an `error` envelope. */
export class JsonRpcError extends Error {
	constructor(readonly code: number, message: string, readonly data?: unknown) {
		super(message);
		this.name = 'JsonRpcError';
	}
}

interface IWireResponseSuccess {
	readonly id: number;
	readonly result: unknown;
	readonly error?: undefined;
	readonly method?: undefined;
}
interface IWireResponseError {
	readonly id: number;
	readonly result?: undefined;
	readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
	readonly method?: undefined;
}
interface IWireRequest {
	readonly id: number;
	readonly method: string;
	readonly params?: unknown;
}
interface IWireNotification {
	readonly id?: undefined;
	readonly method: string;
	readonly params?: unknown;
}
type WireMessage = IWireResponseSuccess | IWireResponseError | IWireRequest | IWireNotification;

/** Result an `onRequest` handler returns for a server→client request. */
export type ServerRequestHandlerResult =
	| { readonly result: unknown; readonly error?: undefined }
	| { readonly result?: undefined; readonly error: { readonly code: number; readonly message: string; readonly data?: unknown } };

/**
 * Minimal transport surface — a real child process or an in-memory pair (tests).
 */
export interface IHermesAcpTransport {
	readonly stdin: Writable;
	readonly stdout: Readable;
	kill(signal?: NodeJS.Signals): boolean;
	readonly onExit: Event<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
	onExitOnce(listener: (e: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void): void;
}

interface IPendingRequest {
	resolve(value: unknown): void;
	reject(reason: unknown): void;
	readonly method: string;
}

const GRACE_KILL_MS = 2_000;

export class HermesAcpConnection extends Disposable {

	private readonly _onExit = this._register(new Emitter<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>());
	readonly onExit = this._onExit.event;

	private readonly _onTransportError = this._register(new Emitter<Error>());
	readonly onTransportError = this._onTransportError.event;

	private _nextId = 1;
	private readonly _pending = new Map<number, IPendingRequest>();
	private readonly _notificationHandlers = new Map<string, (params: unknown) => void>();
	private readonly _requestHandlers = new Map<string, (params: unknown) => Promise<ServerRequestHandlerResult> | ServerRequestHandlerResult>();

	private _exited = false;
	private _disposed = false;
	private _buf = '';

	constructor(
		private readonly _transport: IHermesAcpTransport,
		private readonly _onLog?: (level: 'info' | 'warn' | 'error', message: string) => void,
		private readonly _graceKillMs = GRACE_KILL_MS,
	) {
		super();
		this._register(this._transport.onExit(e => this._handleExit(e)));
		this._transport.stdout.setEncoding?.('utf8');
		this._register(this._listenToStdout());
	}

	private _listenToStdout(): IDisposable {
		const onData = (chunk: string | Buffer) => {
			this._buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			let nl: number;
			while ((nl = this._buf.indexOf('\n')) >= 0) {
				const line = this._buf.slice(0, nl).trim();
				this._buf = this._buf.slice(nl + 1);
				if (line.length === 0) {
					continue;
				}
				let parsed: WireMessage;
				try {
					parsed = JSON.parse(line) as WireMessage;
				} catch {
					this._log('error', `parse error on line: ${line.slice(0, 200)}`);
					continue;
				}
				this._dispatch(parsed);
			}
		};
		this._transport.stdout.on('data', onData);
		return toDisposable(() => this._transport.stdout.off('data', onData));
	}

	private _dispatch(msg: WireMessage): void {
		const hasId = hasKey(msg, { id: true });
		const hasMethod = hasKey(msg, { method: true });
		// Response envelope (id + result|error, no method).
		if (hasId && !hasMethod && (hasKey(msg, { result: true }) || hasKey(msg, { error: true }))) {
			const id: unknown = (msg as { id?: unknown }).id;
			if (typeof id !== 'number') {
				this._log('warn', `unsolicited response id=${String(id)}`);
				return;
			}
			const pending = this._pending.get(id);
			if (!pending) {
				this._log('warn', `unsolicited response id=${id}`);
				return;
			}
			this._pending.delete(id);
			if (hasKey(msg, { error: true }) && msg.error) {
				pending.reject(new JsonRpcError(msg.error.code, msg.error.message, msg.error.data));
			} else {
				pending.resolve((msg as IWireResponseSuccess).result);
			}
			return;
		}
		// Server→client request (method + id).
		if (hasMethod && hasId && msg.id !== undefined && msg.method !== undefined) {
			void this._handleServerRequest(msg as IWireRequest);
			return;
		}
		// Server→client notification (method, no id).
		if (hasMethod && msg.method !== undefined) {
			this._handleServerNotification(msg as IWireNotification);
			return;
		}
		this._log('warn', `unrecognized message: ${JSON.stringify(msg).slice(0, 200)}`);
	}

	private async _handleServerRequest(msg: IWireRequest): Promise<void> {
		const handler = this._requestHandlers.get(msg.method);
		if (!handler) {
			this._writeMessage({ id: msg.id, error: { code: JsonRpcErrorCode.MethodNotFound, message: `Method not found: ${msg.method}` } });
			return;
		}
		try {
			const result = await handler(msg.params);
			if (result.error) {
				this._writeMessage({ id: msg.id, error: result.error });
			} else {
				this._writeMessage({ id: msg.id, result: result.result });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._log('error', `handler for ${msg.method} threw: ${message}`);
			this._writeMessage({ id: msg.id, error: { code: JsonRpcErrorCode.InternalError, message } });
		}
	}

	private _handleServerNotification(msg: IWireNotification): void {
		const handler = this._notificationHandlers.get(msg.method);
		if (!handler) {
			this._log('warn', `dropping unhandled notification: ${msg.method}`);
			return;
		}
		try {
			handler(msg.params);
		} catch (err) {
			this._log('error', `notification handler ${msg.method} threw: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private _writeMessage(message: unknown): boolean {
		if (this._exited || this._disposed) {
			return false;
		}
		try {
			this._transport.stdin.write(JSON.stringify(message) + '\n');
			return true;
		} catch (err) {
			this._onTransportError.fire(err instanceof Error ? err : new Error(String(err)));
			return false;
		}
	}

	private _handleExit(e: { code: number | null; signal: NodeJS.Signals | null }): void {
		if (this._exited) {
			return;
		}
		this._exited = true;
		const reason = `hermes acp exited (code=${e.code}, signal=${e.signal})`;
		for (const [id, pending] of this._pending) {
			pending.reject(new JsonRpcError(JsonRpcErrorCode.InternalError, `${reason}; request id=${id} (${pending.method}) aborted`));
		}
		this._pending.clear();
		this._onExit.fire(e);
	}

	/** Issue a request; resolves with the typed response payload (caller names `R`). */
	request<R = unknown>(method: string, params?: unknown): Promise<R> {
		if (this._disposed) {
			return Promise.reject(new CancellationError());
		}
		if (this._exited) {
			return Promise.reject(new JsonRpcError(JsonRpcErrorCode.InternalError, 'transport has exited'));
		}
		const id = this._nextId++;
		return new Promise<R>((resolve, reject) => {
			this._pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
			const payload: { id: number; method: string; params?: unknown } = { id, method };
			if (params !== undefined) {
				payload.params = params;
			}
			if (!this._writeMessage(payload)) {
				this._pending.delete(id);
				reject(new JsonRpcError(JsonRpcErrorCode.InternalError, 'write failed; transport closed'));
			}
		});
	}

	/** Fire-and-forget notification. */
	notify(method: string, params?: unknown): void {
		const payload: { method: string; params?: unknown } = { method };
		if (params !== undefined) {
			payload.params = params;
		}
		this._writeMessage(payload);
	}

	/** Register a handler for a server-pushed notification (one per method). */
	onNotification(method: string, handler: (params: unknown) => void): IDisposable {
		this._notificationHandlers.set(method, handler);
		return toDisposable(() => {
			if (this._notificationHandlers.get(method) === handler) {
				this._notificationHandlers.delete(method);
			}
		});
	}

	/** Register a handler for a server-initiated request (one per method). */
	onRequest(method: string, handler: (params: unknown) => Promise<ServerRequestHandlerResult> | ServerRequestHandlerResult): IDisposable {
		this._requestHandlers.set(method, handler);
		return toDisposable(() => {
			if (this._requestHandlers.get(method) === handler) {
				this._requestHandlers.delete(method);
			}
		});
	}

	override dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		for (const pending of this._pending.values()) {
			pending.reject(new CancellationError());
		}
		this._pending.clear();
		try {
			this._transport.stdin.end();
		} catch { /* already closed */ }
		if (!this._exited) {
			const timer = setTimeout(() => {
				try {
					this._transport.kill('SIGKILL');
				} catch { /* already dead */ }
			}, this._graceKillMs) as unknown as { unref?(): void };
			this._transport.onExitOnce(() => clearTimeout(timer as unknown as ReturnType<typeof setTimeout>));
			timer.unref?.();
		}
		super.dispose();
	}

	private _log(level: 'info' | 'warn' | 'error', message: string): void {
		this._onLog?.(level, message);
	}
}

/** Wrap a node child process into an {@link IHermesAcpTransport}. */
export function transportFromChildProcess(child: {
	stdin: Writable | null;
	stdout: Readable | null;
	kill: (signal?: NodeJS.Signals) => boolean;
	once: (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
}): IHermesAcpTransport {
	if (!child.stdin || !child.stdout) {
		throw new Error('Child process has no stdio pair');
	}
	return {
		stdin: child.stdin,
		stdout: child.stdout,
		kill: signal => child.kill(signal),
		onExit: Event.fromNodeEventEmitter(child as unknown as NodeJS.EventEmitter, 'exit', (code: number | null, signal: NodeJS.Signals | null) => ({ code, signal })),
		onExitOnce: listener => child.once('exit', (code, signal) => listener({ code, signal })),
	};
}
