#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const productPath = join(here, '..', '..', 'product.json');
const dryRun = process.argv.includes('--dry-run');
if (!existsSync(productPath)) {
  console.error(`product.json not found at ${productPath}`);
  process.exit(1);
}

const product = JSON.parse(readFileSync(productPath, 'utf8'));
const changes = [];

if ('defaultChatAgent' in product) {
  delete product.defaultChatAgent;
  changes.push('removed defaultChatAgent (GitHub Copilot wiring)');
}
if ('trustedExtensionAuthAccess' in product) {
  delete product.trustedExtensionAuthAccess;
  changes.push('removed trustedExtensionAuthAccess (Copilot auth grant)');
}
if (typeof product.serverLicenseUrl === 'string' && /github\.com\/microsoft\/vscode/i.test(product.serverLicenseUrl)) {
  product.serverLicenseUrl = product.licenseUrl;
  changes.push(`rewrote serverLicenseUrl → ${product.licenseUrl}`);
}
if (typeof product.webviewContentExternalBaseUrlTemplate === 'string' && /vscode-cdn\.net/i.test(product.webviewContentExternalBaseUrlTemplate)) {
  delete product.webviewContentExternalBaseUrlTemplate;
  changes.push('removed webviewContentExternalBaseUrlTemplate (vscode-cdn.net endpoint)');
}

if (!changes.length) {
  console.log('✓ nothing to strip — product.json already free of targeted proprietary bits');
  process.exit(0);
}
if (dryRun) {
  console.log('— DRY RUN — would apply:');
  for (const change of changes) console.log(`  • ${change}`);
  process.exit(0);
}
const backupPath = `${productPath}.preStrip`;
if (!existsSync(backupPath)) copyFileSync(productPath, backupPath);
writeFileSync(productPath, `${JSON.stringify(product, null, '\t')}\n`, 'utf8');
console.log('✓ stripped Microsoft-proprietary product wiring:');
for (const change of changes) console.log(`  • ${change}`);
