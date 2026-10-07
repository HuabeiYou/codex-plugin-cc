---
name: codex-native-supervision
description: Use before delegating implementation, investigation, plan or implementation review, adversarial review, or follow-up feedback to Codex, and while supervising its completion or failure.
user-invocable: false
---

# Supervise Codex workers

You are the parent Claude. You own each Codex worker through completion of the user's task.

1. Prepare the delegated task within the user's authorized scope. The worker uses the same runtime as rescue: workspace file edits by default, persistent Codex threads, and no fixed task-duration cap. For explicit read-only work or investigation without edits, send `write: false`.
2. Keep one Codex conversation per topic. Start a new worker through Claude's Agent tool for a new topic, independent review, or separate parallel assignment. Retain a topic-to-worker mapping with its agent ID, task handle, request, and harness output file path. Use background execution for substantial work so you can continue independent work.
3. Read the full report from native Agent completion feedback or the retained Agent `outputFile` with `Read`. The Mod saves the Codex report at Claude's native output-file path; retain this launch handle as the source for the path. If `TaskOutput` is available, use it for a bounded wait when required; a wait timeout keeps the task pending. Continue supervising automatically until each required report has been read.
4. Verify the report against your request, handle errors and partial work, and continue the user's authorized task. An Agent can finish with a Codex failure report: check the report's content before treating it as success.
5. Finish when the user's task is complete or has a concrete blocker. When the task is stopped, cancel your owned pending workers using native task controls.

## Follow-up on the same topic

Send adjustments to the worker that implemented that topic. After addressing a reviewer's findings, send the revised plan or implementation back to that same reviewer for re-review, including adversarial review. The implementation worker and its independent reviewer are separate conversations; retain both mappings even when their tasks interleave.

Use Claude's `SendMessage` tool addressed to the retained worker ID. A finished subagent resumes with the message and the Mod appends a turn to its exact Codex conversation. Include the feedback, relevant changes, and requested verification. Wait for its current turn to finish before requesting the next round, then read the new report. A reused worker returns to the active list instead of creating another entry. Use IDs as routing handles internally; identify workers to the user by their topic.

Review topics use `write: false` on their initial request. Follow-ups retain that read-only boundary, model, and effort unless explicitly narrowed or the user selects new model controls. Keep an independent reviewer separate from implementation work. If the original worker is unavailable, report the failed continuation and recover explicitly rather than silently targeting another topic.

Completed plugin-owned conversations are archived when the Claude session ends with its workers idle. Their history and reports remain saved; feedback unarchives and continues the same conversation. Active and interrupted workers are excluded from cleanup.

## Task controls

A plain prompt uses rescue's write-capable default. To select controls, send the Agent prompt as a JSON object:

```json
{"task":"Implement the requested fix and run relevant checks.","write":true}
```

Optional fields:

- `write`: boolean; set false for read-only scope.
- `resumeLast`: boolean; legacy explicit continuation of the latest tracked task in this Claude session. Topic follow-ups use `SendMessage` to the retained worker instead.
- `model`: string; include only when the user selects a model. `spark` is the existing runtime alias.
- `effort`: string; include only when the user selects reasoning effort.

Preserve the task text in `task`; keep runtime controls in their fields. Use native Agent foreground/background options rather than asking the companion to detach. The worker stays attached until Codex finishes, even for long implementation tasks.

The activity pane is optional user inspection. Native task feedback is the parent supervision path. The user does not need to request status or result retrieval. Opening Claude's agents view preserves the worker identity and resumes its exact interrupted Codex thread after the session handoff. Continue reading completion feedback or the retained launch report automatically. Saved threads also support explicit continuation. Arbitrary exit/restart restoration remains outside this guarantee.

Use native task handles for waits and cancellation. Never create shell wait loops or use process-name polling for worker supervision.
