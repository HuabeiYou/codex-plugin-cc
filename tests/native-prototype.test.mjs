import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { makeTempDir } from "./helpers.mjs";
import { runCodex, cancelRun } from "../plugins/codex-native-prototype/scripts/bridge.mjs";
import { createRun, acceptEvent, readEvents } from "../plugins/codex-native-prototype/hooks/protocol.mjs";

function fixture(behavior) {
  const bin = makeTempDir();
  installFakeCodex(bin, behavior);
  return { bin, env: buildEnv(bin), cwd: makeTempDir(), runId: randomUUID(), prompt: "Read README.md exactly once." };
}

test("native bridge streams a real app-server protocol turn without repeating its final text or executing tools twice", async () => {
  const options = fixture("native-stream-task");
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

test("native bridge returns failed status and the provider error instead of success", async () => {
  const result = await runCodex(fixture("native-failed-task"), () => {});
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Synthetic provider failure");
});

test("native cancellation sends turn/interrupt to the owning thread and waits for interrupted completion", async () => {
  const options = fixture("interruptible-slow-task");
  await runCodex(options, (event) => {
    if (event.kind === "ready") assert.equal(cancelRun(options.runId).requested, true);
  }).then((result) => assert.equal(result.status, "interrupted"));
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
