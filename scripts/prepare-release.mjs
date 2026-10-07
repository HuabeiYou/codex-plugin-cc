#!/usr/bin/env node
// The committed marketplace must install the same bytes a clean build produces.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSinglePlugin } from './build-single-plugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'release');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: prepare-release.mjs [--check]');

function contents(directory, prefix = '') {
  return fs.readdirSync(path.join(directory, prefix)).sort().flatMap((name) => {
    const relative = path.join(prefix, name);
    // Claude generates its version-specific declarations when loading the Mod.
    if (relative === path.join('plugins', 'codex', '.claude-plugin', 'types')) return [];
    const file = path.join(directory, relative);
    return fs.statSync(file).isDirectory() ? contents(directory, relative) : [[relative, fs.readFileSync(file, 'utf8')]];
  });
}

function verifyMarketplace(version) {
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json')));
  assert.equal(marketplace.name, 'codex-companion');
  assert.equal(marketplace.owner.name, 'HuabeiYou');
  assert.equal(marketplace.metadata.version, version);
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'codex');
  assert.equal(marketplace.plugins[0].source, './release/plugins/codex');
  assert.equal(marketplace.plugins[0].version, version);
}

if (check) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-companion-release-check-'));
  try {
    const result = buildSinglePlugin(path.join(temporary, 'release'), { release: true });
    verifyMarketplace(result.version);
    const actual = contents(destination);
    const expected = contents(result.marketplaceRoot);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('Release package is stale. Run npm run release:prepare.');
    }
    console.log(`Release ${result.version} matches deterministic generation.`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
} else {
  const result = buildSinglePlugin(destination, { release: true });
  verifyMarketplace(result.version);
  console.log(JSON.stringify(result, null, 2));
}
