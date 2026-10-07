---
name: codex-job-supervision
description: Use in the parent Claude whenever it delegates to codex-rescue, launches a Codex review or companion task, receives background or timeout feedback, or receives completion feedback. Own each delegated job through reading its result and completing the user's task.
user-invocable: false
---

# Supervise delegated Codex jobs

You are the parent Claude. You remain responsible for every Codex job you launch. A forwarding agent finishing its handoff does not finish your task. Background execution changes scheduling, not ownership.

1. Retain each job's request, Claude task handle, output file path, and companion job ID when available. Track each job separately. Keep the user's task pending while required results are outstanding.
2. For a Claude background Agent or Bash task, use its exact native handle and completion notification. Read the returned report or the harness-provided output file with `Read`. If available, use `TaskOutput` for a bounded wait when you need its result before continuing. A timeout keeps the task pending. Continue independent work meanwhile.
3. For a detached companion job, use its printed job ID. For a foreground call that the harness backgrounds, read the original task's output file for the `Companion job ID:` progress line. That ID is saved before Codex starts. The Claude task handle is a different identifier. If needed, list companion jobs with `status --json`; use an ID only when it is correlated to your launch. Keep using the original native handle if the match is unclear; do not ask the user to identify your subagent.
4. Wait for each confirmed companion job with one bounded runtime call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" status <job-id> --wait --timeout-ms 30000 --json
```

If the snapshot is still `queued` or `running`, keep the job pending. Continue independent work, or issue another bounded wait when its result is needed. Each call returns control to you. Never create shell wait loops or use process-name polling (`pgrep`, `ps | grep`).

5. When the job is `completed`, `failed`, or `cancelled`, read its full feedback, including errors and partial work:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" result <job-id>
```

6. Assess the feedback against the delegated request. Verify relevant changes or claims, and continue the user's authorized task. A launch receipt, a timeout, or a successful wrapper exit is not proof of Codex success. On failure, preserve the error and partial work; recover within the existing scope or explain a concrete blocker. Keep review-only requests read-only.
7. Finish after every required owned job has a result you have read and handled, and the user's task is complete or has a concrete blocker. If the user stops the task, cancel only your owned pending jobs with native task controls or companion `cancel <job-id>`.

You perform this supervision automatically. The user does not need to ask for progress or request result retrieval. Status and result commands remain available for optional inspection.
