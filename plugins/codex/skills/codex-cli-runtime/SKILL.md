---
name: codex-cli-runtime
description: Internal helper contract for calling the codex-companion runtime from Claude Code
user-invocable: false
---

# Codex Runtime

Use this skill only inside the `codex:codex-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task [runtime options] -- '<prompt>'`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct Codex CLI strings, or any other Bash activity.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from `codex:codex-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `gpt-5-4-prompting` skill to rewrite the user's request into a tighter Codex prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.
- Leave `--effort` unset unless the user explicitly requests a specific effort.
- Leave model unset by default. Add `--model` only when the user explicitly asks for one.
- Map `spark` to `--model gpt-5.3-codex-spark`.
- Default to a write-capable Codex run by adding `--write` unless the user explicitly asks for read-only behavior or only wants review, diagnosis, or research without edits.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.
- If the forwarded request includes `--model`, normalize `spark` to `gpt-5.3-codex-spark` and pass it through to `task`.
- If the forwarded request includes `--effort`, pass it through to `task`.
- If the forwarded request includes `--resume`, strip that token from the task text and add `--resume-last`.
- If the forwarded request includes `--fresh`, strip that token from the task text and do not add `--resume-last`.
- `--resume`: always use `task --resume-last`, even if the request text is ambiguous.
- `--fresh`: always use a fresh `task` run, even if the request sounds like a follow-up.
- `--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `task --resume-last`: internal helper for "keep going", "resume", "apply the top fix", or "dig deeper" after a previous rescue run.

Prompt assembly:
- Pass the prompt inline, as the last arguments and after a `--` delimiter: `task [runtime options] -- '<prompt>'`. Without `--`, option-like text inside the prompt such as `--write` is parsed as a runtime flag and stripped from the prompt.
- Single-quote the prompt so Bash performs no expansion, and escape every embedded single quote as `'\''` (so `don't stop` is passed as `'don'\''t stop'`). Never wrap the prompt in double quotes: `$(...)`, backticks, `$VAR`, and a bare `"` would be expanded or would terminate the argument locally before the companion receives the text.
- Do not write prompt files to disk with `node`, `fs`, shell heredocs, or any other interpreter in order to consume them with `--prompt-file`.

Background and timeout fallback:

- If the Bash harness moves the call to the background or reports a timeout, return the harness message unchanged and stop. Your handoff ends here; the parent continues supervision with `codex-job-supervision`. This is the fallback when final companion stdout is unavailable; it takes precedence over the normal stdout-only response and Bash-failure rules.
- The harness task ID is not a companion job ID. Preserve the harness handle exactly; do not invent a companion job ID or suggest `/codex:status` for that handle.
- For an explicit companion `task --background` launch, return the companion's printed job ID and status suggestion unchanged and stop.
- Never create a shell wait loop or use process-name polling (`pgrep`, `ps | grep`, `watch`, `tail`) to recover output. Such matches can include sibling waiters and unrelated jobs. Do not issue a second Bash call, retry the task, or read a task output file.

Safety rules:
- Default to write-capable Codex work in `codex:codex-rescue` unless the user explicitly asks for read-only behavior or only wants review, diagnosis, or research without edits.
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Codex cannot be invoked, return nothing.
