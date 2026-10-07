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
const release = process.argv.includes('--release');
const realWorkflow = process.argv.includes('--real-workflow');
const typecheck = process.argv.includes('--typecheck');
const usesProvider = real || realWorkflow;
if (real && realWorkflow) throw new Error('Choose --real or --real-workflow.');
if (release && bundled) throw new Error('Choose --release or --bundle.');
const pluginSource = process.env.CODEX_NATIVE_ACCEPTANCE_PLUGIN_ROOT || path.join(root, release ? 'release/plugins/codex' : bundled ? 'output/codex-local-marketplace/plugins/codex' : 'plugins/codex-native-prototype');
const pluginName = JSON.parse(fs.readFileSync(path.join(pluginSource, '.claude-plugin/plugin.json'))).name;
if (process.argv.slice(2).some((arg) => !['--real', '--real-workflow', '--bundle', '--release', '--typecheck'].includes(arg))) throw new Error('Usage: native-prototype-acceptance.mjs [--real|--real-workflow] [--bundle|--release] [--typecheck]');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-acceptance-'));
const pluginRoot = path.join(directory, 'plugin');
fs.cpSync(pluginSource, pluginRoot, { recursive: true });
if (pluginName === 'codex-native-prototype') fs.cpSync(path.join(root, 'plugins/codex'), path.join(directory, 'codex'), { recursive: true });
const config = path.join(directory, 'claude-config'); fs.mkdirSync(config);
let userConfig = {};
if (process.env.CODEX_NATIVE_ACCEPTANCE_NO_USER_CONFIG !== '1') {
  try { userConfig = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const testApiKey = 'sk-ant-native-lifecycle-fixture';
fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true,
  cachedGrowthBookFeatures: userConfig.cachedGrowthBookFeatures, cachedDynamicConfigs: userConfig.cachedDynamicConfigs,
  customApiKeyResponses: { approved: [testApiKey.slice(-20)], rejected: [] } }));
const reports = [];
let passed = false;

function execute(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', 'Run native acceptance', '--max-turns', env.CODEX_NATIVE_ACCEPTANCE_REAL_WORKFLOW === '1' ? '10' : env.CODEX_NATIVE_ACCEPTANCE_REUSE === '1' ? '8' : '2',
      // The scripted parent has a fixed tool set. Auto mode would call a
      // classifier on the deliberately blocked Claude provider endpoint.
      '--permission-mode', 'acceptEdits', '--allowedTools', 'Agent,Read,SendMessage,TaskStop',
      '--setting-sources', '', '--settings', JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } }),
      '--plugin-dir', pluginRoot,
      '--plugin-dir', path.join(root, 'tests/fixtures/native-agent-driver'), '--output-format', 'json'],
    { cwd: env.CODEX_NATIVE_ACCEPTANCE_CWD || root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeoutMs = usesProvider ? 300_000 : 90_000;
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Claude acceptance exceeded ${timeoutMs / 1000} seconds.`)); }, timeoutMs);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000); });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        fs.writeFileSync(path.join(directory, 'claude-failure.json'), stdout, { mode: 0o600 });
        reject(new Error(`Claude exited ${code}: ${stderr || stdout.slice(-1500)}`)); return;
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Claude did not return JSON.')); }
    });
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

try {
  const scenarios = realWorkflow ? [{ cancel: false, background: false, reuse: true }]
    : [{ cancel: false, background: false }, { cancel: false, background: true }, { cancel: true, background: true }, ...(!real ? [{ cancel: false, background: true, watchdog: true }, { cancel: false, background: false, reuse: true }] : [])];
  for (const scenario of scenarios) {
    const { cancel, background, watchdog, reuse } = scenario;
    const bin = path.join(directory, reuse ? 'reuse' : watchdog ? 'watchdog' : cancel ? 'cancel' : background ? 'background' : 'complete');
    fs.mkdirSync(bin);
    if (!usesProvider) installFakeCodex(bin, reuse ? 'native-stream-task' : watchdog ? 'native-activity-only-task' : cancel ? 'interruptible-slow-task' : 'native-edit-task');
    const env = { ...(usesProvider ? process.env : buildEnv(bin)),
      CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: testApiKey, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CODEX_NATIVE_ACCEPTANCE_CANCEL: cancel ? '1' : '0',
      CODEX_NATIVE_ACCEPTANCE_BACKGROUND: background ? '1' : '0',
      CODEX_NATIVE_ACCEPTANCE_REUSE: reuse ? '1' : '0',
      CODEX_NATIVE_ACCEPTANCE_REAL_WORKFLOW: realWorkflow ? '1' : '0',
      CODEX_NATIVE_ACCEPTANCE_AGENT_TYPE: `${pluginName}:worker`,
      CLAUDE_PLUGIN_DATA: path.join(directory, 'plugin-data'),
      ...(watchdog ? { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '2000' } : {}),
      CODEX_NATIVE_ACCEPTANCE_TASK: JSON.stringify({ write: real ? false : true, task: realWorkflow
        ? 'Create greeting.mjs exporting function greet(name) that returns "Hello, " + name + "!". Create greeting.test.mjs using node:test and strict assertions to verify greet("Ada"). Run node --test greeting.test.mjs. Only edit those two files in this isolated workspace. Do not commit, install packages, or change configuration.' : cancel
        ? 'Perform a thorough read-only review of this repository. Inspect implementation and tests; report architecture and integration issues in detail. Do not edit files.'
        : real ? 'Read README.md and describe this repository in one sentence. Do not edit anything.' : 'Implement a test change in the isolated acceptance workspace.' }) };
    if (!real) { env.CODEX_NATIVE_ACCEPTANCE_CWD = path.join(directory, reuse ? 'reuse-workspace' : watchdog ? 'watchdog-workspace' : cancel ? 'cancel-workspace' : background ? 'background-workspace' : 'edit-workspace'); fs.mkdirSync(env.CODEX_NATIVE_ACCEPTANCE_CWD); }
    const startedAt = Date.now();
    const response = await execute(env);
    const wallMs = Date.now() - startedAt;
    assert.equal(response.is_error, false);
    assert.equal(Object.keys(response.modelUsage ?? {}).length, 0, 'Parent/child must not invoke Claude models');
    const detail = JSON.parse(response.result);
    fs.writeFileSync(path.join(directory, `${reuse ? 'reuse' : cancel ? 'cancel' : watchdog ? 'watchdog' : background ? 'background' : 'complete'}-detail.json`), JSON.stringify(detail));
    const ready = detail.bridgeEvents.find((event) => event.kind === 'ready');
    assert.ok(ready?.threadId && ready.appServerPid, 'Codex app-server must actually start');
    const lifecycle = response.subagent_stats;
    if (reuse) {
      assert.equal(lifecycle.spawned, 3, 'Feedback must reuse the worker instead of spawning');
      if (realWorkflow) {
        const results = detail.bridgeEvents.filter((event) => event.kind === 'result');
        assert.ok(results.length >= 3);
        assert.ok(results.every((event) => event.status === 'completed'), 'All real Codex turns must succeed');
        assert.equal(detail.feedbackCheckpoints.length, 2);
        assert.equal(detail.feedbackReceipts.length, 2);
        assert.ok(detail.feedbackReceipts.every((receipt) => !receipt.isError));
        assert.equal(detail.feedbackReceipts[0].requestedAgentId, detail.launches[0].agentId);
        assert.equal(detail.feedbackReceipts[1].requestedAgentId, detail.launches[1].agentId);
        assert.equal(detail.reportReads.length, 2);
        assert.ok(detail.reportReads.every((report) => !report.isError && report.text.includes('Codex task completed')));
        const readyEvents = [...detail.bridgeEvents.filter((event) => event.kind === 'ready').slice(0, 3), ...detail.feedbackCheckpoints];
        assert.equal(readyEvents.length, 5);
        assert.equal(readyEvents[3].threadId, readyEvents[0].threadId);
        assert.equal(readyEvents[4].threadId, readyEvents[1].threadId);
        assert.equal(readyEvents[0].sandbox, 'workspace-write');
        assert.equal(readyEvents[1].sandbox, 'read-only');
        assert.equal(readyEvents[4].sandbox, 'read-only');
        assert.equal(new Set(readyEvents.map((event) => event.threadId)).size, 3);
        const { spawnSync } = await import('node:child_process');
        const verification = spawnSync(process.execPath, ['--input-type=module', '-e', 'import assert from "node:assert/strict"; import {greet} from "./greeting.mjs"; assert.equal(greet("Ada"), "Hello, Ada!"); assert.equal(greet(""), "Hello, world!");'], { cwd: env.CODEX_NATIVE_ACCEPTANCE_CWD, encoding: 'utf8' });
        assert.equal(verification.status, 0, verification.stderr);
        const tests = spawnSync(process.execPath, ['--test', 'greeting.test.mjs'], { cwd: env.CODEX_NATIVE_ACCEPTANCE_CWD, encoding: 'utf8' });
        assert.equal(tests.status, 0, tests.stdout + tests.stderr);
        for (const event of readyEvents) assert.equal(alive(event.appServerPid), false, 'All real Codex app-servers must exit');
        assert.deepEqual(fs.readdirSync(env.CODEX_NATIVE_ACCEPTANCE_CWD).sort(), ['greeting.mjs', 'greeting.test.mjs']);
        reports.push({ mode: 'REAL_CODEX_SCRIPTED_CLAUDE_PARENT', scenario: 'implementation-feedback-adversarial-rereview', sessionId: response.session_id, workers: 3, turns: 5,
          threads: readyEvents.map((event) => ({ threadId: event.threadId, sandbox: event.sandbox, model: event.model })), claudeModelCalls: 0, workspaceAssertions: 'initial greeting and empty-name follow-up passed', appServersAlive: false, parentReadReports: 2, wallMs });
        continue;
      }
      assert.equal(detail.completions.length, 5);
      assert.equal(detail.completions[3].agentId, detail.completions[0].agentId);
      assert.equal(detail.completions[4].agentId, detail.completions[1].agentId);
      const state = JSON.parse(fs.readFileSync(path.join(bin, 'fake-codex-state.json')));
      assert.equal(state.threads.length, 3);
      assert.equal(state.turnStarts.length, 5);
      assert.equal(state.turnStarts[3].threadId, state.turnStarts[0].threadId);
      assert.equal(state.turnStarts[4].threadId, state.turnStarts[1].threadId);
      assert.equal(state.turnStarts[3].prompt, 'Fix the review findings on your original implementation.');
      assert.equal(state.turnStarts[4].prompt, 'I addressed your findings. Re-review the revised implementation.');
      assert.equal(state.lastThreadResume.sandbox, 'read-only');
      assert.equal(new Set(state.archivedThreads).size, 3, 'Session end must archive all idle plugin-owned topics');
      reports.push({ scenario: 'topic-reuse', wallMs, workers: 3, turns: 5, archived: 3 });
      continue;
    }
    assert.equal(lifecycle.spawned, 1);
    assert.deepEqual(detail.openedPanes, ['codex-native-activity'], 'Worker launch opens the activity pane once');
    assert.ok(detail.activityNotices.length > 0, 'Worker must publish live activity');
    assert.ok(detail.activityNotices.every((n) => n.agentId === detail.child.agentId && n.stored), 'All activity must be stored in the owned worker transcript');
    assert.ok(!detail.child.answer.includes('activity display was unavailable'), detail.child.answer);
    if (!cancel && !real) {
      assert.ok(detail.activityNotices.some((n) => n.text.includes('File change')), 'File activity must be published');
      assert.ok(!detail.childMessages.some((m) => m.text.includes('File change')), 'Activity notices must stay out of model input');
    }
    if (cancel) {
      assert.ok(detail.bridgeEvents.some((event) => event.type === 'turn' && event.turnId), 'Cancel an actual started Codex turn');
      assert.equal(detail.stopped?.taskId, detail.agentId);
      assert.equal(detail.stopped?.isError, false);
      assert.equal(Object.values(lifecycle.killed).reduce((sum, count) => sum + count, 0), 1);
      assert.equal(detail.child?.isAborted, true);
    } else {
      assert.equal(lifecycle.completed, 1, watchdog ? 'Actual Codex activity must keep the native stream watchdog alive' : undefined);
      assert.equal(background ? lifecycle.started_in_background : lifecycle.requested.foreground, 1);
      assert.equal(detail.child?.reason, 'answer');
      assert.ok(detail.child.answer.length > 0);
      if (!real) assert.equal(detail.child.answer, 'Read-only answer.', 'Progress must not become the final report');
      if (watchdog) {
        const outputs = detail.bridgeEvents.filter((e) => e.type === 'commandOutput');
        assert.ok(outputs.length >= 12, 'The watchdog fixture must actually emit command output');
        assert.ok(outputs.at(-1).receivedAt - outputs[0].receivedAt > 2000, 'Actual Codex activity must span the shortened host watchdog interval');
      }
      if (background) { assert.equal(detail.feedback?.isError, false, detail.feedback?.text); assert.ok(detail.feedback?.text?.length > 0); if (!real) assert.ok(detail.feedback.text.includes('Read-only answer.')); }
      assert.equal(detail.bridgeEvents.find((event) => event.kind === 'result')?.status, 'completed');
      if (!real) {
        assert.equal(ready.sandbox, 'workspace-write');
        assert.ok(detail.bridgeEvents.some((e) => e.type === 'fileChange'));
        assert.equal(fs.readFileSync(path.join(env.CODEX_NATIVE_ACCEPTANCE_CWD, 'native-edit-proof.txt'), 'utf8'), 'edited by simulated Codex');
      }
    }
    for (let attempts = 0; attempts < 20 && alive(ready.appServerPid); attempts++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(alive(ready.appServerPid), false, 'Codex app-server must not survive agent completion/TaskStop');
    if (!real && cancel) {
      const state = JSON.parse(fs.readFileSync(path.join(bin, 'fake-codex-state.json')));
      assert.ok(state.lastInterrupt, 'TaskStop must reach Codex turn/interrupt');
    }
    reports.push({ mode: real ? 'REAL' : 'SIMULATED_CODEX_REAL_CLAUDE_LIFECYCLE', scenario: watchdog ? 'activity-only-watchdog' : cancel ? 'task-stop' : background ? 'background-completion-feedback' : real ? 'foreground-completion' : 'implementation-completion',
      plugin: pluginName, sessionId: response.session_id, agentId: detail.agentId ?? detail.child.agentId, threadId: ready.threadId,
      model: ready.model ?? null, appServerPid: ready.appServerPid, appServerAlive: false,
      claudeModelCalls: 0, parentReadReport: background && !cancel ? detail.feedback?.isError === false : null,
      workerActivityNotices: detail.activityNotices.length, automaticPanes: detail.openedPanes.length,
      watchdogTimeoutMs: watchdog ? 2000 : null,
      wallMs, cliReportedDurationMs: response.duration_ms, lifecycle });
  }
  if (typecheck) {
    assert.ok(fs.existsSync(path.join(pluginRoot, '.claude-plugin/types/claude-code/index.d.ts')), 'Claude must generate fresh Mod API types during acceptance');
    const { spawnSync } = await import('node:child_process');
    const checked = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(pluginRoot, 'tsconfig.json')], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  }
  console.log(JSON.stringify({ passed: true, typecheck, reports }, null, 2));
  passed = true;
} finally {
  if (passed) fs.rmSync(directory, { recursive: true, force: true });
  else console.error(`Acceptance diagnostics retained at ${directory}`);
}
