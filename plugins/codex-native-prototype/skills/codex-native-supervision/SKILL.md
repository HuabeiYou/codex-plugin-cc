---
name: codex-native-supervision
description: Use in the parent Claude before spawning a codex-native-prototype worker or when receiving its background, timeout, completion, or failure feedback. Supervise every native Codex agent through reading its report and completing the user's task.
user-invocable: false
---

# Supervise native Codex agents

You are the parent Claude. You own every Codex worker you spawn.

1. Retain each worker's native agent ID, task handle, request, and harness output file path. Keep the user's task pending while required results are outstanding.
2. Use Claude's native Agent completion feedback. Read the full report or the harness-provided output file with `Read`. If available, use `TaskOutput` for a bounded wait when you need the result before continuing. A timeout keeps the worker pending; continue independent work meanwhile.
3. Assess the report against your request. Verify relevant claims, read errors and partial work, and continue the user's authorized task. A worker can return a visible Codex failure message even when Claude marks the Agent completed; check the report's content before treating it as success.
4. Finish after each required worker's feedback has been read and handled and the user's task is complete or has a concrete blocker. When the user stops the task, stop only your owned pending workers with Claude's native task controls.

The native Mod uses Claude agent IDs, not companion job IDs. Use native task feedback for supervision. The activity pane is optional inspection, not a substitute for reading the report. Never create shell wait loops or use process-name polling to wait for a worker. The user does not need to request status or result retrieval. This prototype's workers remain read-only.
