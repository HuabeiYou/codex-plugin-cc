#!/usr/bin/env node
// Native Claude lifecycle around the existing write-capable rescue runtime.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { executeNativeTask } from "../../codex/scripts/codex-companion.mjs";
import { pluginEnvironment } from "../../codex/scripts/lib/plugin-context.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

export function reportPath(runId, env = process.env) {
  controlDirectory(runId); // Validate the same per-agent identity.
  env = pluginEnvironment(pluginRoot, env);
  return path.join(env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'codex-native-reports'), 'native-reports', `${runId}.txt`);
}

function publishReport(runId, env = process.env) {
  const reportFile = reportPath(runId, env);
  const bindingFile = reportFile + '.binding.json';
  if (!fs.existsSync(bindingFile) || !fs.existsSync(reportFile)) return;
  const { outputFile, agentId } = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  if (!path.isAbsolute(outputFile) || path.basename(path.dirname(outputFile)) !== 'tasks' || path.basename(outputFile) !== `${agentId}.output`) throw new Error('Invalid native output binding.');
  const temporary = outputFile + '.' + runId + '.tmp';
  fs.copyFileSync(reportFile, temporary);
  fs.chmodSync(temporary, 0o600);
  // Replace only this worker's temporary artifact. Never write through the
  // harness symlink into its (absent) model transcript or another agent's file.
  fs.renameSync(temporary, outputFile);
}

export function bindOutput(runId, outputFile, agentId, env = process.env) {
  const reportFile = reportPath(runId, env);
  if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(agentId) || !path.isAbsolute(outputFile)
      || path.basename(path.dirname(outputFile)) !== 'tasks' || path.basename(outputFile) !== `${agentId}.output`) throw new Error('Invalid native output binding.');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(reportFile + '.binding.json', JSON.stringify({ outputFile, agentId }), { mode: 0o600 });
  publishReport(runId, env);
  return { bound: true };
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

// A JSON envelope carries explicit controls; a plain task keeps rescue's write default.
export function taskRequest(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("A task prompt is required.");
  if (!prompt.trim().startsWith('{')) return { prompt, write: true };
  let request;
  try { request = JSON.parse(prompt); } catch { return { prompt, write: true }; }
  if (!request || !Object.hasOwn(request, 'task')) return { prompt, write: true };
  const allowed = new Set(['task', 'write', 'resumeLast', 'model', 'effort']);
  if (Object.keys(request).some((key) => !allowed.has(key))) throw new Error("Unknown native task control.");
  if (typeof request.task !== 'string' || !request.task.trim()) throw new Error("The task must be a nonempty string.");
  for (const key of ['write', 'resumeLast']) if (request[key] !== undefined && typeof request[key] !== 'boolean') throw new Error(`${key} must be boolean.`);
  for (const key of ['model', 'effort']) if (request[key] !== undefined && typeof request[key] !== 'string') throw new Error(`${key} must be a string.`);
  return { prompt: request.task, write: request.write !== false, resumeLast: request.resumeLast === true,
    model: request.model, effort: request.effort };
}

async function execute(prompt, signal, emit, nativeRunId, resumeFrom) {
  const request = taskRequest(prompt);
  let threadId;
  const texts = new Map();
  const phases = new Map();
  const pending = new Map();
  const emitText = (itemId, text) => { if (text) emit({ kind: 'text', threadId, itemId, text }); };
  const execution = await executeNativeTask({ ...request, cwd: process.cwd(), signal, nativeRunId, resumeFrom,
    // One owned connection lets native cancellation close only this agent's harness.
    clientOptions: { disableBroker: true, capabilities: { experimentalApi: false, optOutNotificationMethods: ["item/reasoning/textDelta"] } },
    onReady: (ready) => { threadId = ready.threadId; emit({ kind: 'ready', ...ready, sandbox: request.write ? 'workspace-write' : 'read-only' }); },
    onNotification: (message) => {
      const p = message.params ?? {};
      if (message.method === 'item/started' || message.method === 'item/completed') {
        const item = p.item;
        if (item.type === 'agentMessage' && p.threadId === threadId) {
          phases.set(item.id, item.phase);
          if (item.phase !== 'commentary') {
            if (pending.has(item.id)) { emitText(item.id, pending.get(item.id)); pending.delete(item.id); }
            if (message.method === 'item/completed') {
              const streamed = texts.get(item.id) ?? '';
              if (!streamed) emitText(item.id, item.text ?? '');
              else if (item.text?.startsWith(streamed)) emitText(item.id, item.text.slice(streamed.length));
            }
          }
        }
        emit({ kind: 'activity', threadId: p.threadId, turnId: p.turnId, type: item.type,
          label: itemLabel(item).slice(0, 1200), status: message.method === 'item/started' ? 'running' : item.status ?? 'completed' });
      } else if (message.method === 'item/agentMessage/delta' && p.threadId === threadId) {
        texts.set(p.itemId, (texts.get(p.itemId) ?? '') + p.delta);
        if (!phases.has(p.itemId)) pending.set(p.itemId, (pending.get(p.itemId) ?? '') + p.delta);
        else if (phases.get(p.itemId) !== 'commentary') emitText(p.itemId, p.delta);
      } else if (message.method === 'item/commandExecution/outputDelta') {
        emit({ kind: 'activity', threadId: p.threadId, turnId: p.turnId, type: 'commandOutput', label: p.delta.slice(-1200), status: 'running' });
      } else if (message.method === 'turn/started' && p.threadId === threadId) {
        emit({ kind: 'activity', threadId, turnId: p.turn.id, type: 'turn', label: 'Codex turn started', status: 'running' });
      } else if (message.method === 'thread/started') {
        emit({ kind: 'activity', threadId: p.thread.id, label: p.thread.agentNickname || 'Codex thread', status: 'starting' });
      }
    }
  });
  return { status: signal.aborted || execution.payload.turnStatus === 'interrupted' ? 'interrupted' : execution.exitStatus === 0 ? 'completed' : 'failed',
    answer: execution.payload.rawOutput, error: execution.payload.error,
    threadId: execution.threadId, turnId: execution.turnId, jobId: execution.jobId,
    touchedFiles: execution.payload.touchedFiles };
}

export async function runCodex({ cwd, prompt, runId, signal, env = process.env, timeoutMs }, emit) {
  taskRequest(prompt);
  env = pluginEnvironment(pluginRoot, env);
  const directory = controlDirectory(runId);
  const reportFile = reportPath(runId, env);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true, mode: 0o700 });
  const checkpointFile = reportFile + '.checkpoint.json';
  const canonicalCwd = fs.realpathSync(cwd);
  let checkpoint = { cwd: canonicalCwd, prompt };
  let resumeFrom;
  if (fs.existsSync(checkpointFile)) {
    const inspect = () => JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    checkpoint = inspect();
    if (checkpoint.cwd !== canonicalCwd) throw new Error('The native checkpoint belongs to a different workspace.');
    // Wait for this run's old host to finish checkpoint cleanup before claiming
    // its identity. A second attachment cannot execute work concurrently.
    for (let attempt = 0; attempt < 50 && fs.existsSync(directory); attempt++) {
      if (signal?.aborted) throw new Error('Native checkpoint recovery was interrupted.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (fs.existsSync(directory)) throw new Error('The prior native run is still owned by another host.');
    checkpoint = inspect();
    if (checkpoint.result && checkpoint.result.status !== 'interrupted') return { ...checkpoint.result, reportFile };
    if (!checkpoint.ready || checkpoint.result?.status !== 'interrupted') {
      throw new Error('Native checkpoint stopped before its interrupted Codex thread was saved.');
    }
    resumeFrom = { jobId: checkpoint.ready.jobId, threadId: checkpoint.ready.threadId, sessionId: checkpoint.ready.sessionId };
    const controls = taskRequest(checkpoint.prompt);
    prompt = JSON.stringify({ task: 'Continue the interrupted task from this thread. Keep the original task scope and constraints.',
      write: controls.write, model: controls.model || checkpoint.ready.model, effort: controls.effort });
  }
  fs.mkdirSync(directory, { mode: 0o700 });
  const saveCheckpoint = () => {
    const temporary = checkpointFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(checkpoint), { mode: 0o600 });
    fs.renameSync(temporary, checkpointFile);
  };
  checkpoint.result = null;
  saveCheckpoint();
  fs.writeFileSync(reportFile, 'Codex task starting.\n', { mode: 0o600 });
  let child;
  let stopRequested = signal?.aborted ?? false;
  let deadlineExceeded = false;
  let deadline;
  let killDeadline;
  const stop = () => {
    stopRequested = true;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    killDeadline ??= setTimeout(() => child.kill('SIGKILL'), 7000);
  };
  signal?.addEventListener('abort', stop);
  const poll = setInterval(() => { if (fs.existsSync(path.join(directory, 'cancel'))) stop(); }, 100);
  try {
    // Spawn with the supplied environment; all shared-runtime state and model
    // lookups then use the same environment as a normal rescue task.
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'execute'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', result;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const finished = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.stdout.on('data', (text) => {
        try {
          const lines = (buffer + text).split('\n'); buffer = lines.pop();
          for (const line of lines.filter(Boolean)) {
            const event = JSON.parse(line);
            if (event.kind === 'result') result = event;
            else if (event.kind === 'error') stderr = event.message;
            else {
              if (event.kind === 'ready') { checkpoint.ready = event; saveCheckpoint(); }
              if (event.kind === 'ready' && timeoutMs !== undefined) deadline = setTimeout(() => { deadlineExceeded = true; stop(); }, timeoutMs);
              emit({ ...event, reportFile, ...(event.kind === 'ready' ? { pluginData: env.CLAUDE_PLUGIN_DATA } : {}) });
            }
          }
        } catch (error) { stop(); reject(error); }
      });
      child.stderr.on('data', (text) => { stderr = (stderr + text).slice(-4000); });
      child.on('close', () => {
        if (deadlineExceeded) reject(new Error('Native task exceeded its explicitly configured connected-task limit.'));
        else if (result) resolve(result);
        else if (stopRequested) resolve({ status: 'interrupted', answer: '' });
        else reject(new Error(stderr || 'Rescue runtime exited without a result.'));
      });
    });
    // Protect against an early abort racing installation of the child's handlers.
    child.stdin.end(JSON.stringify({ prompt, nativeRunId: runId, resumeFrom }));
    if (stopRequested) stop();
    // No production task-duration cap. Tests may request a deadline explicitly.
    const completed = await finished;
    checkpoint.result = completed;
    saveCheckpoint();
    fs.writeFileSync(reportFile, `Codex task ${completed.status}\n\n${completed.answer || completed.error || ''}\n`, { mode: 0o600 });
    publishReport(runId, env);
    return { ...completed, reportFile };
  } catch (error) {
    checkpoint.result = { status: 'failed', answer: '', error: error.message };
    saveCheckpoint();
    fs.writeFileSync(reportFile, `Codex task failed\n\n${error.message}\n`, { mode: 0o600 });
    publishReport(runId, env);
    throw error;
  } finally {
    clearInterval(poll); clearTimeout(deadline); clearTimeout(killDeadline);
    signal?.removeEventListener('abort', stop);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const [command, runId] = process.argv.slice(2);
  if (command === 'bind-output') { console.log(JSON.stringify(bindOutput(runId, process.argv[4], process.argv[5]))); return; }
  if (command === 'report-path') {
    const reportFile = reportPath(runId);
    console.log(JSON.stringify({ reportFile, pluginData: path.dirname(path.dirname(reportFile)) })); return;
  }
  if (command === 'cancel') {
    const result = cancelRun(runId);
    if (result.requested && process.argv[4] === '--wait') {
      for (let attempt = 0; attempt < 70 && fs.existsSync(controlDirectory(runId)); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
      result.finished = !fs.existsSync(controlDirectory(runId));
    }
    console.log(JSON.stringify(result)); return;
  }
  if (command !== 'run' && command !== 'execute') throw new Error('Usage: bridge.mjs run|cancel <run-id>');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdout.on('error', (error) => { if (error.code === 'EPIPE') stop(); else throw error; });
  const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    const result = command === 'execute' ? await execute(request.prompt, controller.signal, emit, request.nativeRunId, request.resumeFrom)
      : await runCodex({ cwd: process.cwd(), prompt: request.prompt, runId, signal: controller.signal }, emit);
    emit({ kind: 'result', ...result });
    process.exitCode = result.status === 'completed' ? 0 : result.status === 'interrupted' ? 130 : 1;
  } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stdout.write(`${JSON.stringify({ kind: 'error', message: error.message })}\n`); process.exitCode = 1; });
}
