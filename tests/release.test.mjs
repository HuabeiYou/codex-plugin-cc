import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSinglePlugin } from '../scripts/build-single-plugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public package has stable version and excludes machine-generated SDK types', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-public-package-'));
  try {
    const { pluginRoot, version } = buildSinglePlugin(path.join(temporary, 'release'), { release: true });
    assert.equal(version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
    assert.equal(fs.existsSync(path.join(pluginRoot, '.claude-plugin/types')), false);
    assert.equal(fs.existsSync(path.join(pluginRoot, 'agents/codex-rescue.md')), false);
    assert.ok(fs.existsSync(path.join(pluginRoot, 'agents/worker.md')));
    assert.match(fs.readFileSync(path.join(pluginRoot, 'NOTICE'), 'utf8'), /OpenAI/);
    assert.match(fs.readFileSync(path.join(pluginRoot, 'NOTICE'), 'utf8'), /HuabeiYou/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('a clean source copy verifies the committed package and rejects stale native runtime', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-release-clean-'));
  try {
    for (const name of ['scripts', 'plugins', 'release', '.claude-plugin', 'package.json', 'package-lock.json']) {
      fs.cpSync(path.join(root, name), path.join(temporary, name), {
        recursive: true,
        filter: (source) => !source.includes(`${path.sep}.generated`) && !source.includes(`${path.sep}.claude-plugin${path.sep}types`)
      });
    }
    const check = () => spawnSync(process.execPath, [path.join(temporary, 'scripts/prepare-release.mjs'), '--check'], { encoding: 'utf8' });
    const clean = check();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    fs.appendFileSync(path.join(temporary, 'plugins/codex-native-prototype/hooks/protocol.mjs'), '\n// changed source\n');
    const stale = check();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Release package is stale/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('feedback observer ignores an old completed checkpoint and requires the new report', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-observer-'));
  const reportFile = path.join(temporary, 'report.txt');
  let child;
  try {
    fs.writeFileSync(reportFile, 'Codex task completed\n\nold report');
    fs.writeFileSync(reportFile + '.checkpoint.json', JSON.stringify({ requestId: 'old', result: { status: 'completed' } }));
    child = spawn(process.execPath, [path.join(root, 'tests/fixtures/native-agent-driver/scripts/wait-for-report.mjs'), reportFile, 'old'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve) => child.on('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(child.exitCode, null, 'An old success must not satisfy a new feedback request');
    fs.writeFileSync(reportFile, 'Codex task completed\n\nnew report');
    fs.writeFileSync(reportFile + '.checkpoint.json', JSON.stringify({ requestId: 'new', result: { status: 'completed' }, ready: { threadId: 'original-thread', sandbox: 'read-only' } }));
    assert.equal(await exited, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), { threadId: 'original-thread', sandbox: 'read-only', resultStatus: 'completed' });
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
