/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../ipc/electron-browser/services.js';
import { IHermesAcpService } from '../common/hermesAcp.js';

// The real implementation lives in the main process (`node/hermesAcpService.ts`)
// because it spawns the `hermes acp` child process. The renderer talks to it
// over IPC via a ProxyChannel; events (`onDidReceiveSessionUpdate`,
// `onDidExit`) and async methods are auto-proxied.
registerMainProcessRemoteService(IHermesAcpService, 'hermesAcp');
