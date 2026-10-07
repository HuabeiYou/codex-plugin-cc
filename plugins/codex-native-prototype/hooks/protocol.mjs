// Pure state/JSONL helpers, shared with the Node acceptance tests.
export function displayText(value, limit = 2400) {
  // Command output can contain terminal cursor/color controls. Claude refuses
  // the whole render tree if a text leaf contains any control but tab/newline.
  const text = String(value ?? '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

export function createRun(agentId, description, id) {
  return { id, agentId, description, status: "starting", threadId: null, turnId: null, model: null, effort: null,
    activity: [], answer: "", result: null, error: null, toolUseId: null, finishedOrder: null };
}

let finishedSequence = 0;
export function isActiveRun(run) {
  return ['starting', 'running', 'stopping'].includes(run.status);
}

export function setRunStatus(run, status) {
  const prior = run.status;
  run.status = status;
  if (isActiveRun(run)) run.finishedOrder = null;
  else if (prior !== status || run.finishedOrder === null) run.finishedOrder = ++finishedSequence;
}

export function acceptEvent(run, event) {
  if (event.kind === "ready") { run.threadId = event.threadId; run.model = event.model ?? null; run.effort = event.effort ?? null; setRunStatus(run, 'running'); }
  if (event.turnId) run.turnId = event.turnId;
  if (event.kind === "activity") {
    run.activity.push(event);
    if (run.activity.length > 100) run.activity.shift();
  } else if (event.kind === "text") {
    run.answer += event.text;
  } else if (event.kind === "result") {
    if (event.threadId) run.threadId = event.threadId;
    run.result = event;
    setRunStatus(run, event.status);
    run.answer = event.answer;
    run.error = event.error ?? null;
  } else if (event.kind === "error") {
    run.error = event.message;
    setRunStatus(run, 'failed');
  }
}

export function readEvents(buffer, text, final = false) {
  const combined = buffer + text;
  const lines = combined.split("\n");
  const rest = final ? "" : lines.pop();
  return { buffer: rest, events: lines.filter((line) => line.trim()).map((line) => JSON.parse(line)) };
}

export function finalAnswer(run) {
  if (run.status === "completed") return run.answer || "Codex completed without a text response.";
  if (run.status === "interrupted") return "Codex task interrupted.";
  return `Codex task failed: ${run.error || "The bridge ended before confirming completion."}`;
}
