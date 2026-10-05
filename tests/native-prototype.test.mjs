import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { makeTempDir } from "./helpers.mjs";
import { runCodex, cancelRun, taskRequest, bindOutput } from "../plugins/codex-native-prototype/scripts/bridge.mjs";
import { createRun, acceptEvent, readEvents, displayText } from "../plugins/codex-native-prototype/hooks/protocol.mjs";
import { pluginEnvironment, publishPluginContext } from "../plugins/codex/scripts/lib/plugin-context.mjs";
import { markReady, waitReady, readinessPath } from '../plugins/codex-native-prototype/scripts/native-ready-server.mjs';

test('pane text removes terminal controls, preserves line breaks and bounds every text leaf', () => {
  const output = '\u001b]0;terminal title\u0007\u001b[32mBuilding\u001b[0m\r\nDone\t✓\rNext\u0008\u0000\u007f';
  assert.equal(displayText(output), 'Building\nDone\t✓\nNext');
  assert.equal(displayText('\u001b]8;;https://example.com\u001b\\Link\u001b]8;;\u001b\\'), 'Link');
  assert.equal(displayText('\u009b31mRed\u009b0m'), 'Red');
  assert.equal(displayText('x'.repeat(10001)).length, 2400);
  assert.equal(displayText('abcdef', 4), 'abc…');
  assert.equal(displayText(null), '');
});

test('host readiness waits for the Mod and rejects another host generation or plugin', async () => {
  const root = makeTempDir();
  const other = makeTempDir();
  const pid = process.pid;
  try {
    await assert.rejects(waitReady(root, pid, 'new-host', 30), /did not initialize/);
    markReady(root, pid, 'old-host');
    await assert.rejects(waitReady(root, pid, 'new-host', 30), /did not initialize/);
    const ready = waitReady(root, pid, 'new-host', 1000);
    setTimeout(() => markReady(root, pid, 'new-host'), 50);
    await ready;
    await assert.rejects(waitReady(other, pid, 'new-host', 30), /did not initialize/);
  } finally { fs.rmSync(readinessPath(root, pid), { force: true }); }
});

function fixture(behavior) {
  const bin = makeTempDir();
  installFakeCodex(bin, behavior);
  return { bin, env: { ...buildEnv(bin), CLAUDE_PLUGIN_DATA: path.join(bin, "data"), CODEX_COMPANION_SESSION_ID: "native-test-session" }, cwd: makeTempDir(), runId: randomUUID(), prompt: "Read README.md exactly once." };
}

test('native bridge CLI runs through a symlinked plugin path', () => {
  const directory = makeTempDir();
  const bridge = path.join(directory, 'linked-bridge.mjs');
  fs.symlinkSync(fileURLToPath(new URL('../plugins/codex-native-prototype/scripts/bridge.mjs', import.meta.url)), bridge);
  const pluginData = path.join(directory, 'plugin-data');
  const response = spawnSync(process.execPath, [bridge, 'report-path', randomUUID()], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: pluginData }
  });
  assert.equal(response.status, 0, response.stderr);
  const result = JSON.parse(response.stdout);
  assert.equal(result.pluginData, pluginData);
  assert.equal(path.dirname(result.reportFile), path.join(pluginData, 'native-reports'));
});

test('native checkpoint continues its exact thread after a session handoff and preserves completion', async () => {
  const options = fixture('interruptible-slow-task');
  const first = await runCodex(options, (event) => {
    if (event.type === 'turn') cancelRun(options.runId);
  });
  assert.equal(first.status, 'interrupted');
  // A different, newer worker must not steal this worker's continuation.
  installFakeCodex(options.bin, 'native-stream-task');
  const other = await runCodex({ ...options, runId: randomUUID() }, () => {});
  const resumed = await runCodex({ ...options, env: { ...options.env, CODEX_COMPANION_SESSION_ID: 'adopted-session' } }, () => {});
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.threadId, first.threadId);
  assert.notEqual(resumed.threadId, other.threadId);
  let state = JSON.parse(fs.readFileSync(path.join(options.bin, 'fake-codex-state.json')));
  assert.equal(state.lastThreadResume.threadId, first.threadId);
  assert.equal(state.lastThreadResume.sandbox, 'workspace-write');
  const starts = state.appServerStarts;
  assert.deepEqual(await runCodex(options, () => {}), resumed);
  state = JSON.parse(fs.readFileSync(path.join(options.bin, 'fake-codex-state.json')));
  assert.equal(state.appServerStarts, starts, 'A delivered checkpoint answer must not execute twice');
  await assert.rejects(runCodex({ ...options, cwd: makeTempDir() }, () => {}), /different workspace/);
});

test('Mods recover the classic hook data path only for the matching plugin root and session', () => {
  const root = makeTempDir();
  const pluginData = makeTempDir();
  const sessionId = randomUUID();
  publishPluginContext(root, sessionId, pluginData);
  const alias = path.join(makeTempDir(), 'plugin');
  fs.symlinkSync(root, alias);
  const env = { CODEX_COMPANION_SESSION_ID: sessionId };
  assert.equal(pluginEnvironment(alias, env).CLAUDE_PLUGIN_DATA, pluginData);
  assert.equal(pluginEnvironment(root, env).CLAUDE_PLUGIN_DATA, pluginData);
  assert.equal(pluginEnvironment(root, { CODEX_COMPANION_SESSION_ID: randomUUID() }).CLAUDE_PLUGIN_DATA, undefined);
  assert.equal(pluginEnvironment(makeTempDir(), env).CLAUDE_PLUGIN_DATA, undefined);
  assert.equal(pluginEnvironment(root, { ...env, CLAUDE_PLUGIN_DATA: '/explicit' }).CLAUDE_PLUGIN_DATA, '/explicit');
});

test("native bridge streams a real app-server protocol turn without repeating its final text or executing tools twice", async () => {
  const options = fixture("native-stream-task");
  options.prompt = JSON.stringify({ task: options.prompt, write: false });
  const events = [];
  const result = await runCodex(options, (event) => events.push(event));
  assert.equal(result.status, "completed");
  assert.equal(result.answer, "Read-only answer.");
  assert.equal(events.filter((e) => e.kind === "text").map((e) => e.text).join(""), result.answer);
  assert.ok(events.some((e) => e.type === "commandOutput"));
  const state = JSON.parse(fs.readFileSync(path.join(options.bin, "fake-codex-state.json")));
  assert.equal(state.appServerStarts, 1);
  assert.equal(state.nativeCommandStarts, 1);
  assert.equal(state.lastThreadStart.sandbox, "read-only");
  assert.equal(state.lastThreadStart.approvalPolicy, "never");
  assert.ok(!state.capabilities.optOutNotificationMethods.includes("item/agentMessage/delta"));
  assert.equal(fs.existsSync(path.join(os.tmpdir(), `codex-native-prototype-${options.runId}`)), false);
});

test("native worker uses rescue write permissions and persists its task for continuation", async () => {
  const options = fixture("native-stream-task");
  const events = [];
  const result = await runCodex(options, (event) => events.push(event));
  const state = JSON.parse(fs.readFileSync(path.join(options.bin, "fake-codex-state.json")));
  assert.equal(state.lastThreadStart.sandbox, "workspace-write");
  assert.equal(state.lastThreadStart.ephemeral, false);
  assert.ok(result.jobId, "Native work must be tracked by the existing rescue runtime");
  assert.match(fs.readFileSync(result.reportFile, "utf8"), /Codex task completed.*Read-only answer\./s);
});

test("native bridge returns failed status and the provider error instead of success", async () => {
  const result = await runCodex(fixture("native-failed-task"), () => {});
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Synthetic provider failure");
});

test("native cancellation sends turn/interrupt to the owning thread and waits for interrupted completion", async () => {
  const options = fixture("interruptible-slow-task");
  await runCodex(options, (event) => {
    if (event.kind === "ready") assert.equal(cancelRun(options.runId).requested, true);
  }).then((result) => {
    assert.equal(result.status, "interrupted");
    const root = path.join(options.bin, "data", "state");
    const workspaceState = path.join(root, fs.readdirSync(root)[0]);
    const job = JSON.parse(fs.readFileSync(path.join(workspaceState, "jobs", result.jobId + ".json")));
    assert.equal(job.status, "cancelled");
    assert.equal(job.pid, null);
  });
  const state = JSON.parse(fs.readFileSync(path.join(options.bin, "fake-codex-state.json")));
  assert.equal(state.lastInterrupt.threadId, state.lastTurnStart.threadId);
  assert.equal(state.lastInterrupt.turnId, state.lastTurnStart.turnId);
  assert.equal(cancelRun(options.runId).requested, false);
});

test("native agent abort interrupts Codex and cleanup completes before the bridge returns", async () => {
  const options = fixture("interruptible-slow-task");
  const controller = new AbortController();
  // Abort after turn/start rather than before the turn exists.
  const timer = setInterval(() => {
    const statePath = path.join(options.bin, "fake-codex-state.json");
    if (fs.existsSync(statePath) && JSON.parse(fs.readFileSync(statePath)).lastTurnStart) controller.abort();
  }, 20);
  try {
    const result = await runCodex({ ...options, signal: controller.signal }, () => {});
    assert.equal(result.status, "interrupted");
    const state = JSON.parse(fs.readFileSync(path.join(options.bin, "fake-codex-state.json")));
    assert.ok(state.lastInterrupt);
  } finally { clearInterval(timer); }
});

test("a connected task timeout fails visibly and cleans up its app-server and control directory", async () => {
  const options = fixture("interruptible-slow-task");
  let pid;
  await assert.rejects(runCodex({ ...options, timeoutMs: 100 }, (event) => {
    if (event.kind === "ready") pid = event.appServerPid;
  }), /connected-task limit/);
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(fs.existsSync(path.join(os.tmpdir(), `codex-native-prototype-${options.runId}`)), false);
});

test("JSONL activity survives arbitrary stdout chunk boundaries and remains bounded", () => {
  const run = createRun("agent", "Task", randomUUID());
  const serialized = JSON.stringify({ kind: "text", text: "Hello 世界" }) + "\n";
  let buffer = "";
  for (const text of serialized) {
    const parsed = readEvents(buffer, text);
    buffer = parsed.buffer;
    for (const event of parsed.events) acceptEvent(run, event);
  }
  assert.equal(run.answer, "Hello 世界");
  for (let i = 0; i < 200; i++) acceptEvent(run, { kind: "activity", label: String(i) });
  assert.equal(run.activity.length, 100);
  assert.equal(run.activity[0].label, "100");
});


test("native implementation changes a workspace file and emits its file-change activity", async () => {
  const options = fixture("native-edit-task");
  const events = [];
  const result = await runCodex({ ...options, prompt: "Implement the requested change." }, (e) => events.push(e));
  assert.equal(result.status, "completed");
  assert.equal(fs.readFileSync(path.join(options.cwd, "native-edit-proof.txt"), "utf8"), "edited by simulated Codex");
  assert.ok(events.some((e) => e.type === "fileChange" && e.status === "completed"));
  assert.ok(result.touchedFiles.includes("native-edit-proof.txt"));
});

test("worker continuation uses rescue's saved thread and explicit model and effort controls", async () => {
  const options = fixture("native-stream-task");
  const first = await runCodex(options, () => {});
  const second = await runCodex({ ...options, runId: randomUUID(), prompt: JSON.stringify({ task: "Continue the fix.", resumeLast: true, model: "spark", effort: "high" }) }, () => {});
  const state = JSON.parse(fs.readFileSync(path.join(options.bin, "fake-codex-state.json")));
  assert.equal(second.threadId, first.threadId);
  assert.equal(state.lastThreadResume.threadId, first.threadId);
  assert.equal(state.lastTurnStart.model, "gpt-5.3-codex-spark");
  assert.equal(state.lastTurnStart.effort, "high");
  assert.notEqual(second.jobId, first.jobId);
});

test("native task controls reject invalid envelopes and preserve option-like task text", () => {
  assert.throws(() => taskRequest('{"task":"Fix it","write":"false"}'), /boolean/);
  assert.throws(() => taskRequest('{"task":"Fix it","unknown":true}'), /Unknown/);
  assert.equal(taskRequest('{"task":"Keep --write and $(echo text) literal","write":false}').prompt, 'Keep --write and $(echo text) literal');
});

test("a native rescue task stays attached beyond the old two-minute limit", { timeout: 160000 }, async () => {
  const options = fixture("native-long-task");
  let connectedAt;
  let pid;
  let stopTimer;
  const events = [];
  try {
    const result = await runCodex(options, (e) => {
      events.push(e);
      if (e.kind === "ready") {
        connectedAt = Date.now(); pid = e.appServerPid;
        stopTimer = setTimeout(() => cancelRun(options.runId), 125000);
      }
    });
    assert.ok(Date.now() - connectedAt >= 125000, "Use actual elapsed time, not a simulated clock");
    assert.equal(result.status, "interrupted");
    assert.ok(events.some((e) => e.type === "turn"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { clearTimeout(stopTimer); }
});


test("native output binding replaces only the owned task artifact, preserving its transcript target", async () => {
  const options = fixture("native-stream-task");
  const tasks = path.join(options.cwd, "tasks");
  fs.mkdirSync(tasks);
  const outputFile = path.join(tasks, "owned-agent.output");
  const transcript = path.join(options.cwd, "model-transcript.jsonl");
  fs.writeFileSync(transcript, '{"original":true}');
  fs.symlinkSync(transcript, outputFile);
  assert.throws(() => bindOutput(options.runId, outputFile, "another-agent", options.env), /Invalid native output/);
  bindOutput(options.runId, outputFile, "owned-agent", options.env);
  await runCodex(options, () => {});
  assert.equal(fs.lstatSync(outputFile).isSymbolicLink(), false);
  assert.match(fs.readFileSync(outputFile, "utf8"), /Codex task completed.*Read-only answer\./s);
  assert.equal(fs.readFileSync(transcript, "utf8"), '{"original":true}');
});
