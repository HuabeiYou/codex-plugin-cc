#!/usr/bin/env node
// Real Claude Agent lifecycle; simulated Codex by default. No parent model calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeCodex, buildEnv } from '../tests/fake-codex-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = process.argv.includes('--real');
const bundled = process.argv.includes('--bundle');
const pluginRoot = path.join(root, bundled ? 'output/codex-local-marketplace/plugins/codex' : 'plugins/codex-native-prototype');
const pluginName = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin/plugin.json'))).name;
if (process.argv.slice(2).some((arg) => !['--real', '--bundle'].includes(arg))) throw new Error('Usage: native-prototype-acceptance.mjs [--real] [--bundle]');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-acceptance-'));
const reports = [];

function execute(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', 'Run native acceptance', '--max-turns', '2',
      '--plugin-dir', pluginRoot,
      '--plugin-dir', path.join(root, 'tests/fixtures/native-agent-driver'), '--output-format', 'json'],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Claude acceptance exceeded 90 seconds.')); }, 90_000);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000); });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error(`Claude exited ${code}: ${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Claude did not return JSON.')); }
    });
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

try {
  for (const cancel of [false, true]) {
    const bin = path.join(directory, cancel ? 'cancel' : 'complete');
    fs.mkdirSync(bin);
    if (!real) installFakeCodex(bin, cancel ? 'interruptible-slow-task' : 'native-stream-task');
    const env = { ...(real ? process.env : buildEnv(bin)),
      CODEX_NATIVE_ACCEPTANCE_CANCEL: cancel ? '1' : '0',
      CODEX_NATIVE_ACCEPTANCE_AGENT_TYPE: `${pluginName}:worker`,
      CODEX_NATIVE_ACCEPTANCE_TASK: cancel
        ? 'Perform a thorough read-only review of this repository. Inspect implementation and tests; report architecture and integration issues in detail. Do not edit files.'
        : 'Read README.md and describe this repository in one sentence. Do not edit anything.' };
    const startedAt = Date.now();
    const response = await execute(env);
    const wallMs = Date.now() - startedAt;
    assert.equal(response.is_error, false);
    assert.equal(Object.keys(response.modelUsage ?? {}).length, 0, 'Parent/child must not invoke Claude models');
    const detail = JSON.parse(response.result);
    const ready = detail.bridgeEvents.find((event) => event.kind === 'ready');
    assert.ok(ready?.threadId && ready.appServerPid, 'Codex app-server must actually start');
    const lifecycle = response.subagent_stats;
    assert.equal(lifecycle.spawned, 1);
    if (cancel) {
      assert.ok(detail.bridgeEvents.some((event) => event.type === 'turn' && event.turnId), 'Cancel an actual started Codex turn');
      assert.equal(detail.stopped?.taskId, detail.agentId);
      assert.equal(detail.stopped?.isError, false);
      assert.equal(Object.values(lifecycle.killed).reduce((sum, count) => sum + count, 0), 1);
      assert.equal(detail.child?.isAborted, true);
    } else {
      assert.equal(lifecycle.completed, 1);
      assert.equal(lifecycle.requested.foreground, 1);
      assert.equal(detail.child?.reason, 'answer');
      assert.ok(detail.child.answer.length > 0);
      assert.equal(detail.bridgeEvents.find((event) => event.kind === 'result')?.status, 'completed');
    }
    for (let attempts = 0; attempts < 20 && alive(ready.appServerPid); attempts++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(alive(ready.appServerPid), false, 'Codex app-server must not survive agent completion/TaskStop');
    if (!real && cancel) {
      const state = JSON.parse(fs.readFileSync(path.join(bin, 'fake-codex-state.json')));
      assert.ok(state.lastInterrupt, 'TaskStop must reach Codex turn/interrupt');
    }
    reports.push({ mode: real ? 'REAL' : 'SIMULATED_CODEX_REAL_CLAUDE_LIFECYCLE', scenario: cancel ? 'task-stop' : 'foreground-completion',
      plugin: pluginName, sessionId: response.session_id, agentId: detail.agentId ?? detail.child.agentId, threadId: ready.threadId,
      model: ready.model ?? null, appServerPid: ready.appServerPid, appServerAlive: false,
      claudeModelCalls: 0, wallMs, cliReportedDurationMs: response.duration_ms, lifecycle });
  }
  console.log(JSON.stringify({ passed: true, reports }, null, 2));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
