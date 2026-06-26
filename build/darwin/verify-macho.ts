/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import path from 'path';
import { open, stat, readdir, realpath, readFile } from 'fs/promises';
import { spawn, ExitCodeError } from '@malept/cross-spawn-promise';
import minimatch from 'minimatch';

const MACHO_PREFIX = 'Mach-O ';
const MACHO_64_MAGIC_LE = 0xfeedfacf;
const MACHO_UNIVERSAL_MAGIC_LE = 0xbebafeca;
const MACHO_ARM64_CPU_TYPE = new Set([
	0x0c000001,
	0x0100000c,
]);
const MACHO_X86_64_CPU_TYPE = new Set([
	0x07000001,
	0x01000007,
]);
const DARWIN_ARCH_PLATFORMS = ['darwin-x64', 'darwin-arm64'];

interface IProductJson {
	builtInExtensions?: Array<{
		name?: string;
		platforms?: string[];
	}>;
}

// Files to skip during architecture validation
const FILES_TO_SKIP = [
	// MSAL runtime files are only present in ARM64 builds
	'**/extensions/microsoft-authentication/dist/libmsalruntime.dylib',
	'**/extensions/microsoft-authentication/dist/msal-node-runtime.node',
	// Copilot SDK: universal app has both x64 and arm64 platform packages
	'**/node_modules/@github/copilot-darwin-x64/**',
	'**/node_modules/@github/copilot-darwin-arm64/**',
	'**/node_modules.asar.unpacked/@github/copilot-darwin-x64/**',
	'**/node_modules.asar.unpacked/@github/copilot-darwin-arm64/**',
	// Copilot prebuilds: single-arch binaries in per-platform directories
	'**/node_modules/@github/copilot/prebuilds/darwin-*/**',
	'**/node_modules.asar.unpacked/@github/copilot/prebuilds/darwin-*/**',
	// Copilot SDK (extensions/copilot): single-arch prebuilds and ripgrep binaries
	'**/node_modules/@github/copilot/sdk/prebuilds/darwin-*/**',
	'**/node_modules/@github/copilot/sdk/ripgrep/bin/darwin-*/**',
	// ripgrep-universal: single-arch binaries in per-platform directories
	'**/node_modules/@vscode/ripgrep-universal/bin/darwin-*/**',
	'**/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-*/**',
	// MXC SDK ships per-arch native binaries under bin/<arch>; the package
	// includes both arm64 and x64 trees regardless of host arch.
	'**/node_modules/@microsoft/mxc-sdk/bin/**',
	'**/node_modules.asar.unpacked/@microsoft/mxc-sdk/bin/**',
	// Copilot SDK tgrep prebuilds: single-arch binaries in per-platform directories
	'**/node_modules/@github/copilot/tgrep/bin/darwin-*/**',
	'**/node_modules.asar.unpacked/@github/copilot/tgrep/bin/darwin-*/**',
	'**/node_modules/@github/copilot/sdk/tgrep/bin/darwin-*/**',
	'**/node_modules.asar.unpacked/@github/copilot/sdk/tgrep/bin/darwin-*/**',
];


function isFileSkipped(file: string, filesToSkip: string[]): boolean {
	return filesToSkip.some(pattern => minimatch(file, pattern));
}

function getSingleDarwinArchBuiltInExtensions(product: IProductJson): string[] {
	const extensions = product.builtInExtensions ?? [];
	const result = new Set<string>();

	for (const extension of extensions) {
		if (!extension.name || !extension.platforms) {
			continue;
		}

		const platforms = new Set(extension.platforms);
		if (platforms.has('darwin')) {
			continue;
		}

		const darwinArchPlatformCount = DARWIN_ARCH_PLATFORMS.filter(platform => platforms.has(platform)).length;
		if (darwinArchPlatformCount > 0 && darwinArchPlatformCount < DARWIN_ARCH_PLATFORMS.length) {
			result.add(extension.name);
		}
	}

	return Array.from(result);
}

async function getAppSpecificFilesToSkip(appPath: string, arch: string): Promise<string[]> {
	if (arch !== 'universal') {
		return [];
	}

	const productJsonPath = path.join(appPath, 'Contents', 'Resources', 'app', 'product.json');
	let productJsonRaw: string;
	try {
		productJsonRaw = await readFile(productJsonPath, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}

		throw err;
	}

	const product = JSON.parse(productJsonRaw) as IProductJson;
	return getSingleDarwinArchBuiltInExtensions(product).map(extensionName => `**/extensions/${extensionName}/**`);
}

async function read(file: string, buf: Buffer, offset: number, length: number, position: number) {
	let filehandle;
	try {
		filehandle = await open(file);
		await filehandle.read(buf, offset, length, position);
	} finally {
		await filehandle?.close();
	}
}

async function checkMachOFiles(appPath: string, arch: string, filesToSkip: string[]) {
	const visited = new Set();
	const invalidFiles: string[] = [];
	const file_header_entry_size = 20;
	const checkx86_64Arch = (arch === 'x64');
	const checkArm64Arch = (arch === 'arm64');
	const checkUniversalArch = (arch === 'universal');
	const traverse = async (p: string) => {
		p = await realpath(p);
		if (visited.has(p)) {
			return;
		}
		visited.add(p);

		const info = await stat(p);
		if (info.isSymbolicLink()) {
			return;
		}
		if (info.isFile()) {
			if (isFileSkipped(p, filesToSkip)) {
				return;
			}

			let fileOutput = '';
			try {
				fileOutput = await spawn('file', ['--brief', '--no-pad', p]);
			} catch (e) {
				if (e instanceof ExitCodeError) {
					/* silently accept error codes from "file" */
				} else {
					throw e;
				}
			}
			if (fileOutput.startsWith(MACHO_PREFIX)) {
				console.log(`Verifying architecture of ${p}`);
				const header = Buffer.alloc(8);
				await read(p, header, 0, 8, 0);

				const header_magic = header.readUInt32LE();
				if (header_magic === MACHO_64_MAGIC_LE) {
					const cpu_type = header.readUInt32LE(4);
					if (checkUniversalArch) {
						invalidFiles.push(p);
					} else if (checkArm64Arch && !MACHO_ARM64_CPU_TYPE.has(cpu_type)) {
						invalidFiles.push(p);
					} else if (checkx86_64Arch && !MACHO_X86_64_CPU_TYPE.has(cpu_type)) {
						invalidFiles.push(p);
					}
				} else if (header_magic === MACHO_UNIVERSAL_MAGIC_LE) {
					const num_binaries = header.readUInt32BE(4);
					assert.equal(num_binaries, 2);
					const file_entries_size = file_header_entry_size * num_binaries;
					const file_entries = Buffer.alloc(file_entries_size);
					await read(p, file_entries, 0, file_entries_size, 8);

					let hasArm64 = false;
					let hasX86_64 = false;
					let hasUnknownCpuType = false;
					for (let i = 0; i < num_binaries; i++) {
						const cpu_type = file_entries.readUInt32LE(file_header_entry_size * i);
						if (MACHO_ARM64_CPU_TYPE.has(cpu_type)) {
							hasArm64 = true;
						} else if (MACHO_X86_64_CPU_TYPE.has(cpu_type)) {
							hasX86_64 = true;
						} else {
							hasUnknownCpuType = true;
						}
					}

					if (hasUnknownCpuType || (checkUniversalArch && (!hasArm64 || !hasX86_64)) || (checkArm64Arch && !hasArm64) || (checkx86_64Arch && !hasX86_64)) {
						invalidFiles.push(p);
					}
				}
			}
		}

		if (info.isDirectory()) {
			for (const child of await readdir(p)) {
				await traverse(path.resolve(p, child));
			}
		}
	};
	await traverse(appPath);
	return invalidFiles;
}

const archToCheck = process.argv[2];
assert(process.env['APP_PATH'], 'APP_PATH not set');
assert(archToCheck === 'x64' || archToCheck === 'arm64' || archToCheck === 'universal', `Invalid architecture ${archToCheck} to check`);
getAppSpecificFilesToSkip(process.env['APP_PATH'], archToCheck).then(filesToSkip => {
	return checkMachOFiles(process.env['APP_PATH']!, archToCheck, [...FILES_TO_SKIP, ...filesToSkip]);
}).then(invalidFiles => {
	if (invalidFiles.length > 0) {
		console.error('\x1b[31mThese files are built for the wrong architecture:\x1b[0m');
		invalidFiles.forEach(file => console.error(`\x1b[31m${file}\x1b[0m`));
		process.exit(1);
	} else {
		console.log('\x1b[32mAll files are valid\x1b[0m');
	}
}).catch(err => {
	console.error(err);
	process.exit(1);
});
