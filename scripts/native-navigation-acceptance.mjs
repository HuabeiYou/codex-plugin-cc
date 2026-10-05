#!/usr/bin/env node
// Real Claude terminal/agents view, simulated Codex, provider traffic blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEvents } from '../plugins/codex-native-prototype/hooks/protocol.mjs';
import { installFakeCodex, buildEnv } from '../tests/fake-codex-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginSource = process.env.CODEX_NATIVE_ACCEPTANCE_PLUGIN_ROOT || path.join(root, 'output/codex-local-marketplace/plugins/codex');
const name = JSON.parse(fs.readFileSync(path.join(pluginSource, '.claude-plugin/plugin.json'))).name;
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-navigation-acceptance-')));
// Claude may retain prewarmed hosts; use an immutable plugin path for this run.
const plugin = path.join(directory, 'codex');
fs.cpSync(pluginSource, plugin, { recursive: true });
if (process.env.CODEX_NAV_WITHOUT_GATE) fs.rmSync(path.join(plugin, '.mcp.json'));
const trace = path.join(directory, 'trace.jsonl');
if (!process.env.CODEX_NAV_WITHOUT_GATE) {
  const file = path.join(plugin, '.mcp.json');
  const manifest = JSON.parse(fs.readFileSync(file));
  manifest['codex-native-ready'].args.push('--trace', trace);
  fs.writeFileSync(file, JSON.stringify(manifest));
}
const driver = path.join(directory, 'driver');
const workspace = path.join(directory, 'workspace');
fs.mkdirSync(workspace);
const claudeConfig = path.join(directory, 'claude-config');
fs.mkdirSync(claudeConfig);
// Keep feature eligibility, but isolate credentials, connectors, session
// records and prewarmed hosts from the user's active Claude installation.
const userConfig = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
const testApiKey = 'sk-ant-navigation-fixture';
fs.writeFileSync(path.join(claudeConfig, '.claude.json'), JSON.stringify({
  hasCompletedOnboarding: true, theme: 'dark', autoUpdates: false,
  cachedGrowthBookFeatures: { ...userConfig.cachedGrowthBookFeatures, ...(process.env.CODEX_NAV_COLD_HOST ? { tengu_bg_spare_enable: false } : {}) },
  cachedDynamicConfigs: userConfig.cachedDynamicConfigs,
  customApiKeyResponses: { approved: [testApiKey.slice(-20)], rejected: [] },
  projects: { [workspace]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } }
}));
fs.cpSync(path.join(root, 'tests/fixtures/native-navigation-driver'), driver, { recursive: true });
fs.writeFileSync(path.join(driver, 'hooks/test-config.json'), JSON.stringify({ trace, agentType: `${name}:worker` }));
const bin = path.join(directory, 'bin'); fs.mkdirSync(bin);
installFakeCodex(bin, 'native-navigation-task');
const wrapper = path.join(directory, 'debug-host.sh');
fs.writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in\n  *--bg-pty-host*) exec "$@" ;;\n  *) exec "$@" --debug-file '${directory}/host-'$$'.txt' ;;\nesac\n`, { mode: 0o700 });
const env = { ...buildEnv(bin), TERM: 'xterm-256color', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  // A skipped/failed Mod must never result in a paid fallback request.
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  ANTHROPIC_API_KEY: testApiKey, CLAUDE_CONFIG_DIR: claudeConfig, ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  CLAUDE_CODE_PROCESS_WRAPPER: wrapper,
  CLAUDE_PLUGIN_DATA: path.join(directory, 'plugin-data'),
  CODEX_NATIVE_NAV_TRACE: trace, CODEX_NATIVE_NAV_AGENT_TYPE: `${name}:worker` };
const requestFile = path.join(directory, 'request.json');
fs.writeFileSync(requestFile, JSON.stringify({ cwd: workspace, env, trace, driver,
  argv: ['claude', '--debug', '--plugin-dir', plugin, '--plugin-dir', driver, '--setting-sources', '', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read',
    '--settings', JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } })] }), { mode: 0o600 });
let passed = false;
try {
  const controller = spawnSync('python3', [path.join(root, 'scripts/native-navigation-pty.py'), requestFile], { encoding: 'utf8', timeout: 60000 });
  assert.equal(controller.status, 0, `Controller failed: ${controller.stderr}. Trace: ${trace}`);
  const terminal = JSON.parse(controller.stdout);
  assert.equal(terminal.navigated, true);
  const rows = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
  const buffers = new Map();
  const events = rows.filter((r) => r.type === 'bridge.chunk').flatMap((r) => {
    const parsed = readEvents(buffers.get(r.hostPid) || '', r.text);
    buffers.set(r.hostPid, parsed.buffer);
    return parsed.events;
  });
  const ready = events.filter((e) => e.kind === 'ready');
  assert.equal(ready.length, 2, 'Launch then restore one owned worker');
  assert.equal(ready[0].threadId, ready[1].threadId, 'Navigation must resume the same Codex thread');
  assert.ok(rows.some((r) => r.type === 'restore.ownership' && r.priorAppServerAlive === false), 'Old app-server must exit before the restored one is ready');
  if (!process.env.CODEX_NAV_WITHOUT_GATE) {
    const marks = rows.filter((r) => r.type === 'mod.ready').map((r) => JSON.parse(r.response.value.stdout));
    const resumed = marks.find((mark) => rows.some((r) => r.type === 'bridge.chunk' && r.hostPid === mark.hostPid && r.text.includes(ready[1].sessionId)));
    assert.ok(resumed, 'Restored host must publish its own Mod readiness');
    const released = rows.find((r) => r.type === 'readiness.release' && r.hostPid === resumed.hostPid);
    assert.ok(released, 'The production MCP readiness handshake must actually complete');
    const restoredReadyAt = rows.find((r) => r.type === 'bridge.chunk' && r.hostPid === resumed.hostPid && r.text.includes(ready[1].sessionId)).at;
    assert.equal(released.markedAt, resumed.markedAt);
    assert.ok(released.at >= resumed.markedAt && released.at <= restoredReadyAt, 'Mod readiness must precede adoption through the MCP connection');
  }
  assert.notEqual(ready[0].sessionId, ready[1].sessionId, 'Exercise the actual agents-view session handoff');
  const child = rows.filter((r) => r.type === 'turn.complete' && r.agentId);
  assert.equal(child.length, 2);
  assert.equal(child[0].agentId, child[1].agentId, 'Claude must retain the worker identity');
  assert.equal(child[0].isAborted, true);
  assert.equal(child[0].answer, '', 'A checkpoint must not write a finished answer');
  assert.equal(child[1].isAborted, false);
  assert.ok(!rows.some((r) => r.type === 'missed.worker'), 'A restored worker must stay in the Codex Mod');
  assert.ok(rows.some((r) => r.type === 'parent.step' && r.agents.some((a) => a.id === child[1].agentId && a.type === `${name}:worker` && a.status === 'completed')));
  assert.ok(rows.some((r) => r.type === 'parent.read' && !r.isError && r.feedback.includes(child[1].answer.replaceAll('\n', '\\n'))), 'Parent reads the complete report automatically');
  for (const item of ready) assert.throws(() => process.kill(item.appServerPid, 0), { code: 'ESRCH' });
  const state = JSON.parse(fs.readFileSync(path.join(bin, 'fake-codex-state.json')));
  assert.equal(state.threads.length, 1, 'Navigation must not create a second task thread');
  assert.equal(state.lastThreadResume.threadId, ready[0].threadId);
  const project = path.join(claudeConfig, 'projects', fs.realpathSync(workspace).replace(/[^a-zA-Z0-9]/g, '-'));
  const assistantMessages = fs.readdirSync(project).filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => fs.readFileSync(path.join(project, file), 'utf8').trim().split('\n').map(JSON.parse))
    .filter((row) => row.type === 'assistant');
  assert.ok(assistantMessages.length > 0);
  assert.ok(assistantMessages.every((row) => row.answeredWithoutRequest === true), 'Every parent response must be scripted across the host handoff');
  console.log(JSON.stringify({ passed: true, mode: 'SIMULATED_CODEX_REAL_CLAUDE_AGENTS_VIEW',
    agentId: child[1].agentId, threadId: ready[0].threadId, fromSession: ready[0].sessionId,
    toSession: ready[1].sessionId, parentReadReport: true, claudeModelCalls: 0,
    modReadyBeforeAdoption: !process.env.CODEX_NAV_WITHOUT_GATE, priorAppServerExitedBeforeRestore: true, ...terminal }, null, 2));
  passed = true;
} finally {
  // Keep a failed trace for diagnosis, but remove the request's inherited env.
  fs.rmSync(requestFile, { force: true });
  if (passed) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
