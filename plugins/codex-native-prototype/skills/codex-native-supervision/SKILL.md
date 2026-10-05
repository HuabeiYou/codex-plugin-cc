---
name: codex-native-supervision
description: Use in the parent Claude before delegating implementation, debugging, investigation, or continuation to the native Codex worker, and when handling its launch, completion, cancellation, or failure feedback.
user-invocable: false
---

# Supervise Codex workers

You are the parent Claude. You own each Codex worker through completion of the user's task.

1. Prepare the delegated task within the user's authorized scope. The worker uses the same runtime as rescue: workspace file edits by default, persistent Codex threads, and no fixed task-duration cap. For explicit read-only work or investigation without edits, send `write: false`.
2. Spawn the worker through Claude's Agent tool. Use background execution for substantial work so you can continue independent work. Retain each agent ID, task handle, request, and harness output file path.
3. Read the full report from native Agent completion feedback or the retained Agent `outputFile` with `Read`. The Mod saves the Codex report at Claude's native output-file path; retain this launch handle as the source for the path. If `TaskOutput` is available, use it for a bounded wait when required; a wait timeout keeps the task pending. Continue supervising automatically until each required report has been read.
4. Verify the report against your request, handle errors and partial work, and continue the user's authorized task. An Agent can finish with a Codex failure report: check the report's content before treating it as success.
5. Finish when the user's task is complete or has a concrete blocker. When the task is stopped, cancel your owned pending workers using native task controls.

## Task controls

A plain prompt uses rescue's write-capable default. To select controls, send the Agent prompt as a JSON object:

```json
{"task":"Implement the requested fix and run relevant checks.","write":true}
```

Optional fields:

- `write`: boolean; set false for read-only scope.
- `resumeLast`: boolean; set true only to continue the latest tracked Codex task from this Claude session. A new task is the default.
- `model`: string; include only when the user selects a model. `spark` is the existing runtime alias.
- `effort`: string; include only when the user selects reasoning effort.

Preserve the task text in `task`; keep runtime controls in their fields. Use native Agent foreground/background options rather than asking the companion to detach. The worker stays attached until Codex finishes, even for long implementation tasks.

The activity pane is optional user inspection. Native task feedback is the parent supervision path. The user does not need to request status or result retrieval. Opening Claude's agents view preserves the worker identity and resumes its exact interrupted Codex thread after the session handoff. Continue reading completion feedback or the retained launch report automatically. Saved threads also support explicit continuation. Arbitrary exit/restart restoration remains outside this guarantee.

Use native task handles for waits and cancellation. Never create shell wait loops or use process-name polling for worker supervision.
