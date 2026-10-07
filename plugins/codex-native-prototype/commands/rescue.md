---
description: Delegate implementation, debugging, or continuation to the native Codex worker
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model>] [--effort <effort>] <task>"
allowed-tools: Read, TaskOutput, TaskStop, Agent, SendMessage, Skill
---

Apply `codex-native-prototype:codex-native-supervision`, then delegate the user request to `codex-native-prototype:worker` through the Agent tool. Claude owns the worker through reading its report and completing this request.

User request:
$ARGUMENTS

Convert explicit routing flags into the skill's JSON task controls. Use `run_in_background: true` for `--background`; use foreground for `--wait`. Otherwise choose background for substantial work. Keep execution flags out of the task text. For feedback on a retained topic, send the request to its original worker with `SendMessage`. Start a fresh worker for a new topic or explicit `--fresh`. Use legacy `resumeLast` only for explicit `--resume` without a retained worker. Keep model and effort unset unless the user chooses them.

Read and handle completion feedback automatically. Return Codex's report after the worker finishes; retain failures and partial work so the next step is clear. The user can inspect the optional activity pane while Claude continues to own the work.
