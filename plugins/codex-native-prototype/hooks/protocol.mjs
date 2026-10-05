// Pure state/JSONL helpers, shared with the Node acceptance tests.
export function createRun(agentId, description, id) {
  return { id, agentId, description, status: "starting", threadId: null, turnId: null, model: null,
    activity: [], answer: "", result: null, error: null, toolUseId: null };
}

export function acceptEvent(run, event) {
  if (event.kind === "ready") { run.threadId = event.threadId; run.model = event.model ?? null; run.status = "running"; }
  if (event.turnId) run.turnId = event.turnId;
  if (event.kind === "activity") {
    run.activity.push(event);
    if (run.activity.length > 100) run.activity.shift();
  } else if (event.kind === "text") {
    run.answer += event.text;
  } else if (event.kind === "result") {
    run.result = event;
    run.status = event.status;
    run.answer = event.answer;
    run.error = event.error ?? null;
  } else if (event.kind === "error") {
    run.error = event.message;
    run.status = "failed";
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
