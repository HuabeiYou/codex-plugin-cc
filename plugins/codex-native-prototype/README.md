# Native Codex worker

The worker runs the existing rescue task runtime inside Claude's native Agent lifecycle. It supports implementation, debugging, file edits, explicit model and effort selection, and continuation of a tracked Codex thread. Claude owns completion and reads the report automatically. The activity view is optional user inspection.

Use the [single-plugin replacement guide](../../SINGLE-PLUGIN.md) to install one Codex plugin. Its agent is `codex:worker`; `/codex:rescue` delegates to that same worker. The old `codex:codex-rescue` forwarding agent is absent from this bundle.

## Development setup

Run `npm run prototype` to load the Mod alone for a new Claude session. In this setup the agent is `codex-native-prototype:worker`.

```text
Use the Codex worker to implement the requested fix and run relevant checks.
```

The parent applies `codex-native-supervision`, passes the task and explicit controls, and uses native Agent foreground/background execution. A plain task uses rescue's workspace-write default. A JSON task envelope can select read-only scope, continuation, model, or reasoning effort; the supervision skill defines those fields.

## Topic conversations

Claude keeps one worker per topic and retains its native handle. Implementation adjustments return to the implementation worker with `SendMessage`. Re-review of a revised plan or implementation returns to its original reviewer, including adversarial review. New topics, independent reviews, and separate parallel assignments start fresh workers. The bundled review commands follow this same lifecycle with read-only workers.

Feedback appends a turn to the exact saved Codex thread and reactivates the existing activity entry. Each request has its own identity, so checkpoint restoration and retries retain the delivered report while new feedback executes once. Follow-ups inherit the topic's model, effort, and sandbox; a read-only reviewer stays read-only. The Mod recognizes queued deliveries and new transcript input, including resumed agents that retain their previous Claude turn ID.

When the Claude session ends with its workers idle, completed plugin-owned conversations are archived recoverably to reduce Codex sidebar clutter. Active or interrupted workers and other sessions' conversations are excluded. Feedback unarchives the exact conversation before resuming it. Cleanup uses one app-server connection per workspace and retains the reports and checkpoints. Exit-time cleanup is best effort; interrupted shutdowns can leave completed threads visible.

## Activity and cancellation

The main transcript keeps Claude's ordinary Agent row. The activity pane opens automatically at worker startup. Active agents appear first with their model, thinking effort, and status in the header. The selected agent's task and activity sit directly beneath its header. Finished agents move into **Previous agents**, folded by default and ordered by completion with the newest first. A folded history shows how many agents failed. Both groups have independent pagination, with up to five agents per page and fewer in short panes. Paging selects an agent on the visible page, and completion keeps the selected active agent visible. Unknown thinking effort is shown as `default` until the runtime resolves it. Entering a worker thread selects that worker. Each active task keeps a visible subtitle so agents using the same model remain distinguishable. Compact activity combines lifecycle events by item identity and shows up to six recent events, adapting to the pane height. **Expand activity** shows the latest 20 retained events with full wrapping and the agent/thread IDs. Expansion is remembered per agent; parent and worker views keep independent selection. Activity and stop controls share a row and wrap on narrow surfaces. `/codex-native-status` reopens the pane and replies only “Opened Codex activity.”; use it when Claude defers automatic pane placement on a narrow terminal. The `p` shortcut folds or opens history while the pane has focus. Each worker retains 100 events.

Open the worker from Claude's agent list to see its live activity in its own transcript. The Mod appends activity as notices addressed to that worker; these notices add no model input. The parent still receives completion feedback and reads the full report automatically.

Real Codex activity also travels through Claude's native stream as progress, separately from answer text. This resets the host's idle watchdog while Codex is active. Pane redraws alone do not count as native stream progress. There is no synthetic heartbeat; a silent, stalled worker remains subject to Claude's watchdog.

Use Claude's task controls, **Stop Codex**, or `/codex-native-stop <agent-id>` to stop an owned worker. Cancellation interrupts its exact Codex turn and closes its app-server. Workers use separate connections so one worker's stop does not close another's harness.

## Shared execution

The native bridge calls `executeNativeTask` in the companion. Both native work and the CLI rescue path use the same tracked-job runner, task execution, sandbox selection, model normalization, saved-thread lookup, and result handling. Task text travels as JSON over stdin; it does not pass through a shell.

Each native task stays attached until completion; there is no fixed two-minute task limit. Its default sandbox is `workspace-write`, with the same `approvalPolicy: never` as rescue. Explicit read-only scope uses `read-only`. The Mod inherits the configured Codex provider and model unless the user selects a model.

Opening Claude's agents view can move the parent and its workers to another host session. The worker definition is available before adoption; an aborted checkpoint stays unfinished. A no-tools MCP startup handshake makes adoption wait for this host's Mod to load. The Mod restores the exact worker identity and resumes its interrupted Codex thread. Claude receives completion feedback and reads the report in the new session. Native jobs and companion status share the plugin data store. An arbitrary exit or restart still does not guarantee automatic restoration. The standalone official plugin source retains its forwarding agent; only our single-plugin bundle removes it.

A failed bridge returns a visible error. Repeated native model steps reuse the result instead of executing the task again. Ordinary Claude agents pass through unchanged. Parent feedback uses native Agent completion and its output-file handle. The Mod saves the full Codex report at that native task artifact; this also supports headless background workers whose Mod-supplied answers do not create a model transcript. It replaces only the owned worker's temporary output artifact, leaving transcript files untouched. Reports are also retained under the plugin data directory's `native-reports` folder.

## Validation

Run `npm run prototype:test`, `npm run prototype:validate`, `npm run prototype:acceptance`, and `npm test`. `npm run prototype:navigation` drives the actual terminal left-arrow handoff with simulated Codex and provider requests blocked. The full Node suite includes an actual elapsed-time check beyond two minutes. Claude generates the Mod API types when it loads the plugin.

The scripted acceptance runner uses real Claude Agent and TaskStop tools with a simulated Codex provider, without model requests. It checks a workspace file edit, activity, completion, cancellation, and process cleanup. `--real` uses the configured provider on explicitly read-only tasks and incurs provider usage.

[Earlier acceptance evidence](ACCEPTANCE.md) covers the former read-only prototype. It is not evidence for the write-capable revision. Use this revision normally for a few days to assess real-provider behavior and interactive terminal layout.
