---
description: Show active and recent Codex jobs for this repository, including review-gate status
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" status "$ARGUMENTS"`

If the user did not pass a job ID:
- Render the command output as a single Markdown table for the current and past runs in this session.
- Keep it compact. Do not include progress blocks or extra prose outside the table.
- Preserve the actionable fields from the command output, including job ID, kind, status, phase, elapsed or duration, summary, and follow-up commands.

If the user did pass a job ID:
- Present the full command output to the user.
- Do not summarize or condense it.

Waiting for a job:
- To request a bounded wait, invoke `/codex:status <job-id> --wait --timeout-ms 30000` with a companion job ID from the runtime output or `/codex:status` job list. The harness task ID is not a companion job ID.
- This command executes before these presentation instructions are read. Present the returned snapshot when the bounded wait ends. An active status after a timeout is not completion; a later explicit wait can use the same job ID.
- The runtime waits on the selected job's stored state, independent of unrelated jobs or waiting shells. Use its bounded wait directly; never create a shell wait loop or use process-name polling (`pgrep`, `ps | grep`) around this command.
