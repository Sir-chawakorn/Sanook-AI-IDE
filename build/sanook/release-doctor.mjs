#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const checks = [];

const product = readJson('product.json');
const overlay = readJson('build/sanook/product.sanook.json');

checkProduct('product.json', product);
checkProduct('build/sanook/product.sanook.json', overlay);
checkReleaseEndpoints(product);
checkSigningReadiness();

if (checks.length > 0) {
	console.error('Sanook release doctor found release blockers:');
	for (const check of checks) {
		console.error(`- ${check}`);
	}
	process.exit(1);
}

console.log('Sanook release doctor passed.');

function readJson(relativePath) {
	return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function checkProduct(label, value) {
	const gallery = value.extensionsGallery;
	if (!gallery?.serviceUrl?.includes('open-vsx.org')) {
		error(`${label}: extensionsGallery.serviceUrl must use Open VSX.`);
	}

	if (containsMicrosoftGalleryUrl(gallery)) {
		error(`${label}: extensionsGallery still references Microsoft Marketplace URLs.`);
	}

	const autoUpdates = new Set(value.builtInExtensionsEnabledWithAutoUpdates ?? []);
	const sessionsAllowlist = new Set(value.sessionsWindowAllowedExtensions ?? []);
	const builtInExtensions = new Map((value.builtInExtensions ?? []).map(extension => [extension.name, extension]));
	for (const extensionName of ['Anthropic.claude-code', 'openai.chatgpt']) {
		const extension = builtInExtensions.get(extensionName);
		if (!extension) {
			error(`${label}: builtInExtensions is missing ${extensionName}.`);
			continue;
		}
		if (!extension.vsix || !existsSync(join(root, extension.vsix))) {
			error(`${label}: ${extensionName} vsix is missing at ${extension.vsix ?? '<unset>'}. Download it into build/sanook/extensions/ before packaging.`);
		}
		if (!autoUpdates.has(extensionName)) {
			error(`${label}: builtInExtensionsEnabledWithAutoUpdates is missing ${extensionName}.`);
		}
		if (!sessionsAllowlist.has(extensionName)) {
			error(`${label}: sessionsWindowAllowedExtensions is missing ${extensionName}.`);
		}
	}
}

function checkReleaseEndpoints(value) {
	if (value.quality !== 'stable') {
		return;
	}

	if ((!value.updateUrl || !value.downloadUrl) && process.env['SANOOK_ACCEPT_UPDATELESS_RELEASE'] !== '1') {
		error('Stable product.json has no updateUrl/downloadUrl. Configure Sanook update infrastructure or set SANOOK_ACCEPT_UPDATELESS_RELEASE=1 for an intentional updateless release.');
	}

	if (!value.extensionsGallery?.controlUrl && process.env['SANOOK_ACCEPT_OPENVSX_WITHOUT_CONTROL'] !== '1') {
		error('Open VSX controlUrl is empty. Configure a Sanook extension control manifest or set SANOOK_ACCEPT_OPENVSX_WITHOUT_CONTROL=1 after accepting that limitation.');
	}
}

function checkSigningReadiness() {
	if (process.env['SANOOK_SKIP_NOTARIZATION_CHECK'] === '1') {
		return;
	}

	for (const name of ['APPLE_DEVELOPER_ID_APPLICATION', 'APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD']) {
		if (!process.env[name]) {
			error(`Missing ${name}; official macOS release signing/notarization is not ready.`);
		}
	}
}

function containsMicrosoftGalleryUrl(gallery) {
	if (!gallery) {
		return false;
	}

	return Object.values(gallery).some(value => typeof value === 'string' && /marketplace\.visualstudio\.com|gallerycdn\.vsassets\.io|az764295\.vo\.msecnd\.net/i.test(value));
}

function error(message) {
	checks.push(message);
}
