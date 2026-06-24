/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

/**
 * Main-process service that owns the `hermes acp` child process and brokers
 * the Agent Client Protocol (ACP) JSON-RPC traffic. Lives in the node layer
 * (it spawns a process) and is exposed to the renderer over IPC via
 * `registerMainProcessRemoteService`.
 *
 * One service instance multiplexes every Hermes session in the window by
 * `sessionId`; the underlying process is spawned lazily on first
 * {@link IHermesAcpService.initialize}.
 */
export const IHermesAcpService = createDecorator<IHermesAcpService>('hermesAcpService');

/** ACP protocol version this client targets (stable subset). */
export const HERMES_ACP_PROTOCOL_VERSION = 1;

/**
 * A single piece of prompt content sent to the agent. ACP defines several
 * block kinds; the M1 subset only needs `text`, but the open shape keeps the
 * type forward-compatible with `image` / `resource_link` blocks (M2+).
 */
export interface IHermesTextContentBlock {
	readonly type: 'text';
	readonly text: string;
}
export type HermesContentBlock = IHermesTextContentBlock | { readonly type: string;[key: string]: unknown };

/** Result of the ACP `initialize` handshake. */
export interface IHermesInitializeResult {
	readonly protocolVersion: number;
	/** Auth methods the agent advertises; empty/`hermes-setup`-only means config is needed. */
	readonly authMethods?: readonly { readonly id: string; readonly name?: string }[];
	readonly agentCapabilities?: Record<string, unknown>;
}

/** A `session/update` notification payload (agent → client). */
export interface IHermesSessionUpdate {
	/** Discriminator, e.g. `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`. */
	readonly sessionUpdate: string;
	/** Present for message/thought chunks: `{ type: 'text', text }`. */
	readonly content?: { readonly type: string; readonly text?: string;[key: string]: unknown };
	[key: string]: unknown;
}

/** Event raised for every inbound `session/update`, tagged with its session. */
export interface IHermesSessionUpdateEvent {
	readonly sessionId: string;
	readonly update: IHermesSessionUpdate;
}

/** Terminal reason a `session/prompt` turn ended. `cancelled`/`refusal`/`max_tokens` are all normal, not errors. */
export interface IHermesPromptResult {
	readonly stopReason: string;
}

export interface IHermesAcpService {
	readonly _serviceBrand: undefined;

	/** Fires for every `session/update` notification from the agent. */
	readonly onDidReceiveSessionUpdate: Event<IHermesSessionUpdateEvent>;

	/** Fires when the underlying `hermes acp` process exits (clean or crash). */
	readonly onDidExit: Event<{ readonly code: number | null; readonly signal: string | null }>;

	/**
	 * Spawn (if needed) and perform the ACP `initialize` handshake. Idempotent:
	 * repeated calls resolve with the same cached result while the process lives.
	 * @param binaryPath Optional override for the `hermes` binary; defaults to
	 *                   `~/.local/bin/hermes` (or `$HERMES_BIN`).
	 */
	initialize(binaryPath?: string): Promise<IHermesInitializeResult>;

	/** Create a new ACP session rooted at `cwd`. */
	newSession(cwd: string): Promise<{ readonly sessionId: string }>;

	/** Send a prompt turn. Resolves when the turn ends (`stopReason`). */
	prompt(sessionId: string, blocks: readonly HermesContentBlock[]): Promise<IHermesPromptResult>;

	/** Request cancellation of the active turn for `sessionId`. */
	cancel(sessionId: string): Promise<void>;
}
