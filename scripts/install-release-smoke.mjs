#!/usr/bin/env node
// Test the root marketplace install without touching personal plugin settings.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-companion-install-'));
const env = { ...process.env, CLAUDE_CONFIG_DIR: temporary, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: 'sk-ant-install-fixture' };
function run(args) {
  const result = spawnSync('claude', args, { cwd: temporary, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
try {
  assert.equal(run(['plugin', 'marketplace', 'add', root, '--json']).outcome, 'ok');
  assert.equal(run(['plugin', 'install', 'codex@codex-companion', '--scope', 'user', '--json']).outcome, 'ok');
  const plugins = run(['plugin', 'list', '--json']);
  assert.equal(plugins.length, 1);
  const installed = plugins[0];
  assert.equal(installed.id, 'codex@codex-companion');
  assert.equal(installed.enabled, true);
  assert.equal(installed.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
  const packageRoot = installed.readFromFolder || installed.installPath;
  assert.ok(fs.existsSync(path.join(packageRoot, 'agents/worker.md')));
  assert.equal(fs.existsSync(path.join(packageRoot, 'agents/codex-rescue.md')), false);
  const hooks = JSON.parse(fs.readFileSync(path.join(packageRoot, 'hooks/hooks.json')));
  assert.deepEqual(hooks.modules, ['./native/register.js']);
  console.log(JSON.stringify({ passed: true, plugin: installed.id, version: installed.version, scope: installed.scope, nativeWorker: true, nativeMod: true, personalSettingsChanged: false }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
