import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildSinglePlugin } from '../scripts/build-single-plugin.mjs';
import { buildEnv, installFakeCodex } from './fake-codex-fixture.mjs';

function contents(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix)).sort().flatMap((name) => {
    const relative = path.join(prefix, name);
    return fs.statSync(path.join(root, relative)).isDirectory()
      ? contents(root, relative)
      : [[relative, fs.readFileSync(path.join(root, relative), 'utf8')]];
  });
}

test('single plugin build is deterministic and contains both hook systems and one namespace', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bundle-'));
  const destination = path.join(temp, 'marketplace');
  try {
    const { pluginRoot } = buildSinglePlugin(destination);
    const before = contents(destination);
    const marketplace = JSON.parse(fs.readFileSync(path.join(destination, '.claude-plugin/marketplace.json')));
    assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ['codex']);
    const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks/hooks.json')));
    assert.ok(hooks.hooks.SessionStart && hooks.hooks.SessionEnd && hooks.hooks.Stop);
    assert.deepEqual(hooks.modules, ['./native/register.js']);
    assert.ok(fs.existsSync(path.join(pluginRoot, 'scripts/native-ready-server.mjs')));
    assert.match(fs.readFileSync(path.join(pluginRoot, '.mcp.json'), 'utf8'), /native-ready-server.mjs/);
    const register = fs.readFileSync(path.join(pluginRoot, 'hooks/native/register.js'), 'utf8');
    assert.match(register, /codex:worker/);
    assert.equal(fs.existsSync(path.join(pluginRoot, 'agents/codex-rescue.md')), false);
    assert.match(fs.readFileSync(path.join(pluginRoot, 'commands/rescue.md'), 'utf8'), /codex:worker/);
    assert.match(fs.readFileSync(path.join(pluginRoot, 'agents/worker.md'), 'utf8'), /codex:codex-native-supervision/);
    assert.doesNotMatch(register, /codex-native-prototype:/);
    assert.ok(fs.existsSync(path.join(pluginRoot, 'skills/codex-job-supervision/SKILL.md')));
    assert.ok(fs.existsSync(path.join(pluginRoot, 'skills/codex-native-supervision/SKILL.md')));
    buildSinglePlugin(destination);
    assert.deepEqual(contents(destination), before);
    fs.mkdirSync(path.join(temp, 'unowned'));
    assert.throws(() => buildSinglePlugin(path.join(temp, 'unowned')), /Refusing to replace/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('bundled native bridge executes in isolation without a sibling official plugin', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bundle-runtime-'));
  try {
    const { pluginRoot } = buildSinglePlugin(path.join(temp, 'marketplace'));
    const bin = path.join(temp, 'bin');
    const cwd = path.join(temp, 'workspace');
    fs.mkdirSync(bin);
    fs.mkdirSync(cwd);
    installFakeCodex(bin, 'native-stream-task');
    const { runCodex } = await import(pathToFileURL(path.join(pluginRoot, 'scripts/native-bridge.mjs')).href);
    const events = [];
    const result = await runCodex({ cwd, prompt: 'Read README.md.', runId: randomUUID(), env: buildEnv(bin) }, (event) => events.push(event));
    assert.equal(result.status, 'completed');
    assert.equal(result.answer, 'Read-only answer.');
    assert.ok(events.some((event) => event.kind === 'ready'));
    assert.equal(fs.existsSync(path.join(temp, 'marketplace/plugins/codex-native-prototype')), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
