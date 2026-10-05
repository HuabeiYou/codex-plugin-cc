#!/usr/bin/env node
// PROTOTYPE: one isolated, read-only Codex app-server per native Claude agent.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../../codex/scripts/lib/app-server.mjs";

function controlDirectory(runId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId)) {
    throw new Error("Invalid prototype run id.");
  }
  return path.join(os.tmpdir(), `codex-native-prototype-${runId}`);
}

export function cancelRun(runId) {
  const directory = controlDirectory(runId);
  // Never create a control directory for an unknown/already-finished run.
  if (!fs.existsSync(directory)) return { requested: false };
  fs.writeFileSync(path.join(directory, "cancel"), "cancel\n", { mode: 0o600 });
  return { requested: true };
}

function itemLabel(item) {
  switch (item.type) {
    case "commandExecution": return item.command;
    case "fileChange": return "File change";
    case "mcpToolCall": return `${item.server}/${item.tool}`;
    case "webSearch": return `Search: ${item.query ?? ""}`;
    case "collabAgentToolCall": return `${item.tool}: ${(item.receiverThreadIds ?? []).join(", ")}`;
    case "agentMessage": return item.text || "Codex is responding";
    case "reasoning": return "Codex is thinking";
    default: return item.type;
  }
}

export async function runCodex({ cwd, prompt, runId, signal, env = process.env, timeoutMs = 120_000 }, emit) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("A task prompt is required.");
  const directory = controlDirectory(runId);
  fs.mkdirSync(directory, { mode: 0o700 });
  let client;
  let threadId;
  let turnId;
  let cancelRequested = signal?.aborted ?? false;
  let interruptSent = false;
  let finished = false;
  let completion;
  let resolveCompletion;
  let rejectCompletion;
  const texts = new Map();
  const phases = new Map();
  const knownThreads = new Set();
  const pendingText = new Map();
  let answer = "";
  completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  // A signal/timeout can arrive during initialize, before completion is awaited.
  void completion.catch(() => {});

  async function interrupt() {
    cancelRequested = true;
    if (!client || !threadId || !turnId || interruptSent || finished) return;
    interruptSent = true;
    stopDeadline = setTimeout(() => rejectCompletion(new Error("Codex did not confirm interruption within five seconds.")), 5000);
    emit({ kind: "activity", threadId, turnId, label: "Stopping Codex", status: "stopping" });
    try {
      await client.request("turn/interrupt", { threadId, turnId });
    } catch (error) {
      rejectCompletion(error);
    }
  }
  const onAbort = () => { void interrupt(); };
  signal?.addEventListener("abort", onAbort);
  const poll = setInterval(() => {
    if (fs.existsSync(path.join(directory, "cancel"))) void interrupt();
  }, 100);
  let deadline;
  let stopDeadline;

  function emitText(itemId, text) {
    if (!text) return;
    answer += text;
    emit({ kind: "text", threadId, turnId, itemId, text });
  }

  try {
    client = await CodexAppServerClient.connect(cwd, {
      disableBroker: true,
      env,
      clientInfo: { name: "codex-native-prototype", title: "Claude native Codex prototype", version: "0.1.0" },
      capabilities: { experimentalApi: false, optOutNotificationMethods: ["item/reasoning/textDelta"] }
    });
    deadline = setTimeout(() => { void interrupt(); rejectCompletion(new Error("Prototype task exceeded its two-minute connected-task limit.")); }, timeoutMs);
    client.setNotificationHandler((message) => {
      const p = message.params ?? {};
      if (message.method === "thread/started") {
        const id = p.thread.id;
        knownThreads.add(id);
        emit({ kind: "activity", threadId: id, label: p.thread.agentNickname || p.thread.name || "Codex thread", status: "starting" });
        return;
      }
      if (p.threadId && !knownThreads.has(p.threadId)) return;
      if (message.method === "turn/started" && p.threadId === threadId) {
        turnId = p.turn.id;
        if (cancelRequested) void interrupt();
      }
      if (message.method === "item/started" || message.method === "item/completed") {
        const item = p.item;
        if (item.type === "collabAgentToolCall") {
          for (const id of item.receiverThreadIds ?? []) knownThreads.add(id);
        }
        if (item.type === "agentMessage") {
          phases.set(item.id, item.phase);
          if (p.threadId === threadId && item.phase !== "commentary") {
            if (pendingText.has(item.id)) { emitText(item.id, pendingText.get(item.id)); pendingText.delete(item.id); }
            if (message.method === "item/completed") {
              const streamed = texts.get(item.id) ?? "";
              // Completed items repeat the text already received as deltas.
              if (!streamed) emitText(item.id, item.text ?? "");
              else if (item.text?.startsWith(streamed)) emitText(item.id, item.text.slice(streamed.length));
            }
          }
        }
        emit({ kind: "activity", threadId: p.threadId, turnId: p.turnId, itemId: item.id, type: item.type,
          label: itemLabel(item).slice(0, 1200), status: message.method === "item/started" ? "running" : item.status ?? "completed" });
      } else if (message.method === "item/agentMessage/delta") {
        texts.set(p.itemId, (texts.get(p.itemId) ?? "") + p.delta);
        if (p.threadId === threadId) {
          if (!phases.has(p.itemId)) pendingText.set(p.itemId, (pendingText.get(p.itemId) ?? "") + p.delta);
          else if (phases.get(p.itemId) !== "commentary") emitText(p.itemId, p.delta);
        }
      } else if (message.method === "item/commandExecution/outputDelta") {
        emit({ kind: "activity", threadId: p.threadId, turnId: p.turnId, itemId: p.itemId, type: "commandOutput", label: p.delta.slice(-1200), status: "running" });
      } else if (message.method === "turn/completed" && p.threadId === threadId) {
        finished = true;
        resolveCompletion(p.turn);
      }
    });
    void client.exitPromise.then(() => { if (!finished) rejectCompletion(client.exitError ?? new Error("Codex connection closed before completion.")); });
    const started = await Promise.race([client.request("thread/start", {
      cwd, model: null, approvalPolicy: "never", sandbox: "read-only", ephemeral: true,
      baseInstructions: "You are executing a read-only task delegated from Claude Code. Inspect and report; do not edit files or request broader permissions."
    }), completion]);
    threadId = started.thread.id;
    knownThreads.add(threadId);
    emit({ kind: "ready", runId, threadId, model: started.model, appServerPid: client.proc?.pid ?? null, sandbox: "read-only" });
    if (cancelRequested) { finished = true; return { status: "interrupted", answer: "", threadId, turnId: null }; }
    const startedTurn = await Promise.race([client.request("turn/start", { threadId, input: [{ type: "text", text: prompt }] }), completion]);
    turnId = startedTurn.turn.id;
    emit({ kind: "activity", threadId, turnId, type: "turn", label: "Codex turn started", status: "running" });
    if (cancelRequested) void interrupt();
    const turn = startedTurn.turn.status === "inProgress" ? await completion : startedTurn.turn;
    finished = true;
    return { status: turn.status, answer, threadId, turnId, error: turn.error?.message ?? null };
  } finally {
    finished = true;
    clearInterval(poll);
    clearTimeout(deadline);
    clearTimeout(stopDeadline);
    signal?.removeEventListener("abort", onAbort);
    await client?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const [command, runId] = process.argv.slice(2);
  if (command === "cancel") { console.log(JSON.stringify(cancelRun(runId))); return; }
  if (command !== "run") throw new Error("Usage: bridge.mjs run|cancel <run-id>");
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  const controller = new AbortController();
  const stop = () => controller.abort();
  const outputError = (error) => { if (error.code === "EPIPE") stop(); else throw error; };
  process.stdout.on("error", outputError);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  try {
    const result = await runCodex({ cwd: process.cwd(), prompt: request.prompt, runId, signal: controller.signal }, emit);
    emit({ kind: "result", ...result });
    process.exitCode = result.status === "completed" ? 0 : result.status === "interrupted" ? 130 : 1;
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    // Keep the EPIPE handler until exit: the parent may close its pipe while a
    // final result/error write is still queued after interruption.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ kind: "error", message: error.message })}\n`);
    process.exitCode = 1;
  });
}
