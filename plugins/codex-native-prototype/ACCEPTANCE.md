# Expanded activity rendering fix (2026-10-05)

The `0.2.3` candidate is staged in `output/codex-pane-staging`. The reported worker's retained activity notices contain ANSI escape characters. Claude rejects the whole pane when a text leaf contains a terminal control character. Compact mode can hide a carriage return by collapsing whitespace; expanded mode previously passed it through. New activity changes the visible history, so the pane can alternate between a valid and a rejected tree.

A real Claude Mod UI test reproduced the failure before the fix: `ui.render (Pane) refused: a text child holds a control character (an escape sequence)`. After the fix, expansion and subsequent live output remain visible on terminal and desktop test surfaces. The pane removes terminal escape sequences, normalizes carriage returns to line breaks, and bounds its text leaves. The original worker events and result stay intact.

All nine Mod tests passed. A focused Node regression covers ANSI colors, terminal titles, hyperlink escapes, carriage returns, control bytes, readable Unicode, and length limits. The staging package passes strict marketplace/plugin validation and TypeScript checks. These are renderer tests rather than a visual soak of the user's active session.

During staging, an unsupported destination argument briefly rebuilt the default bundle. It was immediately restored from the matching `0.2.1` staging copy; the final candidate uses a separate directory. Installation settings were not changed.

---

# Agents-view handoff fix (2026-10-05)

The `0.2.2` candidate is staged in `output/codex-navigation-staging`, separately from the installed local marketplace. The user confirmed that pressing left arrow alone lost a running worker; there was no restart. That action checkpoints the child and adopts it into another Claude host session.

The fix addresses three observed failures:

- An exception or clean bridge exit after an abort could write a final answer. Claude then treated the checkpointed child as finished. Both abort paths now leave the turn unfinished.
- Dynamic agent registration and volatile run state were unavailable during adoption. A static worker definition and persisted bridge identity, data path, prompt, and exact interrupted job now survive the handoff. Native work and companion commands share the same plugin data store.
- Claude Code 2.1.289 could start an adopted `codex:worker` request before its Mod was loaded. A captured host log shows the worker API request at `10:06:17.354Z` and Mod loading at `.355Z`. A no-tools local MCP handshake holds the host's existing adoption barrier until the Mod publishes readiness. The gate uses canonical plugin root, parent PID, and process birth identity. It is bounded to ten seconds. If the Mod cannot load, the static Claude fallback reports runtime failure; only the Codex runtime executes implementation work.

Claude independently reviewed the aborted-turn patch and then the startup handshake. Its second review led to locale-independent process identity, private readiness storage, safer temporary-file creation, malformed-input handling, cleanup on normal session end, and stronger acceptance checks. Claude's documented `$.process.spawn` abort behavior and the real handoff test verify that the old process is stopped before restoration. The handshake remains a workaround for an observed host startup race; a later Claude release may change this ordering.

## Real terminal, simulated Codex

The terminal runner presses left arrow once, with model requests blocked. It verifies the same native agent and Codex thread, automatic parent report reading, readiness before adoption, and old app-server exit before the resumed one starts. Three consecutive uninstrumented production-plugin runs passed before adding handshake trace assertions (4.360, 4.740, and 4.679 seconds).

The final package passed with both prewarmed and cold background hosts:

| Host | Agent | Original session | Adopted session | Wall time |
| --- | --- | --- | --- | --- |
| Warm | `a47a9f1c8bfde79c0` | `6475e7a7-ab59-4ff1-bbaa-4795571f224c` | `7aa4237a-cc17-4915-bbc7-de04812247b4` | 4.441 s |
| Cold | `a63b7554096b59a88` | `106854c2-4def-4ae5-9f57-7441231fc7a4` | `ba0ed046-93e4-4f6d-b1cc-c5aee5c82b20` | 4.430 s |

Both restored `thr_1`, created no second Codex thread, made zero Claude model requests, and delivered the complete report automatically. Removing only the handshake caused the negative-control run to time out after 50 seconds, with no restored result. The test configuration, workspace, and plugin copy are isolated from the installed package. Failed traces remain available locally; inherited environment snapshots are deleted.

Early harness iterations made unintended Claude requests in an empty synthetic workspace before the provider block and scripted driver survived the host handoff. Later runs use a dummy Claude API key, a blocked provider endpoint, and isolated configuration. A lifecycle test initially loaded the older installed plugin alongside staging; immutable plugin copies and isolated configuration removed that ambiguity.

## Automated checks and qualification

The full Node suite passed **116/116** in 134.3 seconds, including the actual task beyond two minutes. Later focused readiness and deterministic-bundle checks passed. Staged Mod tests passed **8/8**, TypeScript checks passed, and strict plugin/marketplace validation passed. The real Claude lifecycle runner with simulated Codex passed file implementation, automatic background feedback, exact-target TaskStop with interrupt acknowledgement, and activity-only watchdog protection.

These checks establish macOS protocol and lifecycle behavior with Claude Code 2.1.289. Linux/Windows and real-provider reliability remain unverified for this patch. The requested normal-use field trial is still needed. Arbitrary exit, hard kill, or restart is outside the automatic-restoration guarantee. The installed local marketplace remains unchanged until the user finishes active work and rebuilds it.

---

# Worker activity and watchdog fix (2026-10-05)

The `0.2.1` staging build `1.0.6-native.0.2.1.h992a221ed026` keeps Claude's ordinary Agent row in the main transcript. Its activity pane opens automatically, uses a five-worker paged selector, and shows only the selected worker's details. Entering a worker thread selects that worker; users can also choose another worker within the pane. Activity starts compact and can be expanded.

The field report exposed a separate native stream defect. The real Codex job `task-muuyfmbw-13sdg8` ran from `07:55:01.208Z` to `08:05:01.263Z`, then became `cancelled` after Claude's 600-second stream watchdog aborted the worker. Updating pane state alone did not produce native stream progress. The Mod now forwards actual Codex activity as native progress chunks and stores worker-scoped activity notices, separate from answer text. It uses no synthetic heartbeat.

The real Claude host, using a **simulated Codex provider**, passed:

| Scenario | Claude session | Evidence |
| --- | --- | --- |
| Implementation | `fcea7ca8-3774-49b0-a9f3-aef822b8a31f` | File edit, eight worker activity notices, one automatic pane, exact final answer |
| Background report | `554441b5-56c4-47ea-8aaf-f05efafde8c1` | Parent Read retrieved the full report; activity stayed out of model input |
| TaskStop | `e15497a6-3ab5-483f-97f2-80cb5d12076b` | Exact owned turn interrupted and app-server stopped |
| Activity without answer text | `60504780-b41d-475f-b63c-dfbe6cf21eea` | Completed with Claude's idle watchdog shortened to 2,000 ms while command activity continued for 3,600 ms before the answer |

The watchdog scenario failed before progress forwarding and passed afterward. It exercised the actual host watchdog, not a simulated timer. Its 4,533 ms total run is a shortened-threshold regression test, not a ten-minute soak. All scenarios used zero Claude model calls, and no owned app-server survived completion or cancellation.

Eight Mod tests passed, including terminal/desktop selection, worker-thread context, paging, automatic opening, unchanged parent rows, display failure, and cancellation. All 111 Node tests passed in 130.5 seconds, including the existing actual 125-second long-task test. Strict plugin/catalog validation and TypeScript checks passed. The default marketplace package and installed copy were left unchanged; the new package is staged in `output/codex-worker-ui-staging` for the next field-test upgrade.

Interactive layout and reliability with the real configured provider remain part of normal-use field testing.

---

# Write-capable worker field-test build (2026-10-05)

The `0.2.0` worker calls the existing rescue runtime. The single-plugin staging build `1.0.6-native.0.2.0.h7c2e1b9f2128` passed strict validation, six Mod tests, and TypeScript checks. Its catalog exposes one worker, and `/codex:rescue` delegates to it.

The real Claude host, using a **simulated Codex provider**, passed:

| Scenario | Claude session | Evidence |
| --- | --- | --- |
| Implementation | `059a9701-c6a4-4777-bb40-b0d6f60e7685` | Workspace file changed, file-change activity emitted, native agent completed |
| Background report | `6fe1df34-cc3e-4685-a79d-00047c9fced8` | Agent completed; parent Read retrieved its full report through the native output-file handle |
| TaskStop | `59bad181-d062-4cf7-a95c-b414dc4b2c9f` | Owned Codex turn interrupted; app-server stopped |

Each run used zero Claude model calls. No owned app-server survived completion or cancellation. All 111 Node tests passed (130.7 seconds for the full suite). They check explicit read-only scope, write permissions, model and effort selection, saved-thread continuation, failure reports, and an actual 125-second task beyond the former two-minute cap.

The background-read test first exposed an unavailable native transcript link. The Mod now publishes the Codex report at the owned native task output artifact, with an atomic replacement that preserves the transcript target. The regression checks the report read and ownership boundary.

These checks establish the runtime and native host paths with a simulated provider. Interactive pixel layout and reliability with the real configured provider remain part of the normal-use field trial. The existing installed package was left unchanged while this staging build was tested.

---

> Historical evidence for the earlier read-only prototype. The current write-capable worker uses the rescue runtime; these real-provider results do not validate that new execution path.

# Prototype acceptance evidence

Validated October 4, 2026 (America/Los_Angeles), using Claude Code 2.1.289, Codex 0.160.0, Node 24.16.0, and configured Codex model `gpt-6.1-sol`.

## Real-provider runs

The final `prototype:acceptance -- --real` run reported `passed: true`. The parent driver supplied deterministic responses and invoked Claude's actual Agent and TaskStop tools. The designated child ran the real Codex app-server with `sandbox: read-only` and `approvalPolicy: never`.

| Scenario | Claude session | Native agent | Codex thread | Actual wall time | Result |
| --- | --- | --- | --- | --- | --- |
| Foreground completion | `36d2da9f-ca8d-42f6-80cb-a755c3af004e` | `a5d02be59dab59051` | `01a10a80-a5e5-7f43-af84-a3cd4e7607c7` | 14.898 s | One spawned, one foreground, one completed |
| TaskStop | `fdfb9ad7-db93-4af8-810a-d67d1b5dacd6` | `aaf64d1ff285a0e7c` | `01a10a80-e246-7061-a04d-6bbcc9a856bb` | 5.428 s | One background agent, aborted by its parent after a Codex turn started |

Both runs had an empty Claude `modelUsage` record. This proves the scripted parent and native child made zero Claude model requests; Codex inference still consumes Codex usage. A normal conversational parent will use Claude inference.

App-server PIDs `75431` and `88672` were absent after completion/TaskStop, verified by `process.kill(pid, 0)` returning `ESRCH`. No orphan app-server remained in either observed run. Cancellation verified native aborted status, a successful TaskStop addressed to the exact agent, and a started Codex turn before the stop.

The CLI's reported durations were 11.818 s and 0.320 s respectively; they exclude portions of background-agent work. The table uses the runner's measured wall time.

## Simulated Codex, real Claude lifecycle

The final default `prototype:acceptance` run also reported `passed: true`:

- Foreground session `a0fd211a-1a74-47cc-9273-bfd8767bf8cf`, agent `aa1af03ff31ed1036`: one completed agent, no surviving app-server.
- TaskStop session `28c31a70-b138-4622-acd1-81dfc3075f1b`, agent `a96e435d2efbd5570`: one parent-aborted agent, exact Codex `turn/interrupt` captured by the fixture, no surviving app-server.

These exercise the real Claude host with a simulated Codex process and no inference. They are protocol/lifecycle evidence, not additional real-provider runs.

## Automated checks

- Six Node bridge/protocol checks pass: streamed answer deduplication and one execution, provider failure, exact-target cancellation, abort cleanup, timeout cleanup, and split JSONL/activity bounds.
- Four Claude Mod engine checks pass: ordinary-agent pass-through, streaming without repeat execution, pane and Agent-row render trees on terminal and desktop, visible bridge failures, and the active Stop button's exact run target.
- Strict plugin manifest validation, version-matched Mod type checking, and the official plugin build pass.
- The full Node regression suite passes **97/97**, including all 91 original checks and six prototype checks (111.938 s).

## Qualification

The UI checks validate render trees and button actions using Claude's own UI kit; they do not establish pixel layout or interactive keyboard navigation. Those require an interactive terminal/desktop pass. Headless live acceptance establishes the native Agent lifecycle, real Codex execution, and process cleanup. This prototype remains read-only, repository-local, and without resume support; see [prototype limits](README.md#prototype-limits).
