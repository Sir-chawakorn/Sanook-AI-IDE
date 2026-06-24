#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const productPath = join(root, 'product.json');
const backupPath = join(root, 'product.json.orig');
const overlayPath = join(here, 'product.sanook.json');
const baseRefArg = process.argv.find(arg => arg.startsWith('--base-ref='))?.slice('--base-ref='.length);
const baseRef = baseRefArg || process.env['SANOOK_PRODUCT_BASE_REF'];

if (!existsSync(productPath)) {
  console.error(`product.json not found at ${productPath}`);
  process.exit(1);
}

const current = JSON.parse(readFileSync(productPath, 'utf8'));
const rawOverlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
const overlay = Object.fromEntries(Object.entries(rawOverlay).filter(([key]) => !key.startsWith('//')));
const base = readBaseProduct(current, overlay, baseRef);
const merged = { ...base, ...overlay };

// Windows AppIds must not collide with Code-OSS/Microsoft. Preserve an existing Sanook
// id once generated so updates keep the same installer identity across releases.
const appIdKeys = ['win32x64AppId', 'win32arm64AppId', 'win32x64UserAppId', 'win32arm64UserAppId'];
for (const key of appIdKeys) {
  const existing = typeof current[key] === 'string' && current[key].startsWith('{{') ? current[key] : undefined;
  merged[key] = existing ?? `{{${randomUUID().toUpperCase()}}`;
}

for (const key of [
  'voiceWsUrl',
  'agentsTelemetryAppName',
  'enableTelemetry',
  'aiConfig',
  'msftInternalDomains',
  'sendASmile',
  'updateUrl',
  'downloadUrl',
  'documentationUrl',
  'experimentsUrl',
  'settingsSearchUrl',
  'surveys',
  'extensionTips',
  'keymapExtensionTips',
  'languageExtensionTips',
  'configBasedExtensionTips',
  'exeBasedExtensionTips',
  'extensionImportantTips',
  'crashReporter',
]) {
  delete merged[key];
}

merged.builtInExtensionsEnabledWithAutoUpdates = merged.builtInExtensionsEnabledWithAutoUpdates ?? [];

writeFileSync(productPath, `${JSON.stringify(merged, null, '\t')}\n`, 'utf8');
console.log('✓ product.json rebranded → Sanook AI IDE');
console.log(`  nameLong       : ${merged.nameLong}`);
console.log(`  applicationName: ${merged.applicationName}`);
console.log(`  gallery        : ${merged.extensionsGallery?.serviceUrl}`);

function readBaseProduct(current, overlay, baseRef) {
  if (baseRef) {
    return JSON.parse(execFileSync('git', ['show', `${baseRef}:product.json`], {
      cwd: root,
      encoding: 'utf8'
    }));
  }

  if (current.applicationName !== overlay.applicationName) {
    return current;
  }

  if (existsSync(backupPath)) {
    console.warn(`Using legacy backup ${backupPath}. Prefer --base-ref=<upstream-ref> for reproducible product generation.`);
    return JSON.parse(readFileSync(backupPath, 'utf8'));
  }

  console.error('product.json is already branded. Re-run with --base-ref=<upstream-ref> or restore an upstream product.json first.');
  process.exit(1);
}
