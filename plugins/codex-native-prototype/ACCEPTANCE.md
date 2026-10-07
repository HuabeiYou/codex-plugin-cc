# Activated local release (2026-10-06)

After the user exited Claude, `codex@huabei-codex` was updated at user scope to `1.0.6-native.0.2.5.h0c082bf8577a`. The installed version and the local marketplace folder match. Final validation passed **131/131** Node tests, **17/17** bundled Mod tests, all **five** real Claude lifecycle scenarios with simulated Codex, strict marketplace/package validation, and the runtime and bundle TypeScript builds. The topic scenario again proved three workers handling five turns and all three completed conversations archived.

The documented bundle validation initially reached its final TypeScript step without the generated Claude Mod API declarations. The generator now retains those local declarations when available; deterministic generation and isolated bundle execution passed again, and `npm run bundle:test` completed without a manual copy step. A fresh checkout must load the native plugin once to generate the declarations, as documented in `SINGLE-PLUGIN.md`.

Obsolete staging bundles can be removed after activation. The entries below are historical acceptance records; their staged versions and installation states describe those earlier checks. Real-provider cache savings and model adherence to the delegation instructions remain unmeasured.

# Topic conversations (2026-10-06)

The staged candidate is `1.0.6-native.0.2.5.h456c156bf47f` in `output/codex-topic-reuse-staging`. Claude retains one native worker per topic. Implementation adjustments and review or adversarial re-review rounds use `SendMessage` to the original worker. New topics and independent reviews get fresh workers. Native review commands are included in the single-plugin bundle; review follow-ups retain their read-only boundary.

Each feedback request appends a turn to the exact Codex thread. Completed checkpoint replay stays idempotent, new transcript input is recognized even if Claude retains the same turn ID, and resumed workers reactivate their existing pane entry. Session-end cleanup archives completed owned conversations only when workers are idle; active, interrupted, and other-session work is excluded. Reports and history remain saved, and subsequent feedback unarchives the exact conversation. Cleanup is best effort on shutdown.

Validation: the full Node suite passed **131/131**, followed by **4/4** focused continuation/cleanup checks after the final runtime refinements. Source and staged Mod suites passed **17/17** each. Source/runtime/staged TypeScript checks, strict source/marketplace/package validation, deterministic regeneration, and isolated bundled execution passed. Both source and staged acceptance passed all **five** real Claude lifecycle scenarios with simulated Codex and no Claude model calls. The topic scenario proved **three workers, five turns, and three archived conversations**, with both implementation feedback and adversarial re-review routed to their original worker and thread after an unrelated topic intervened.

The real terminal agents-view handoff also passed in **4.176 seconds**: the original app-server exited before restoration, the worker and Codex thread identities stayed the same, and the parent read the full report after adoption. The first attempt was blocked by sandbox-denied process inspection. A subsequent run completed the handoff but exposed the test observer's assumption that every pipe chunk held one JSON object. The observer now reconstructs JSONL across chunk boundaries; the final isolated run passed with process inspection enabled and provider traffic blocked. No user sessions or installed plugin files were changed.

The installed `0.2.3` package remains untouched. Activate this candidate after finishing delegated work and closing Claude sessions, using `SINGLE-PLUGIN.md`. These checks verify routing, lifecycle, and archival behavior; they do not measure real-provider cache savings or whether a live Claude model follows the delegation instructions reliably.

# Human-readable command feedback (2026-10-06)

The current staged revision is `1.0.6-native.0.2.4.h93352ebba35e`. `/codex-native-status` now opens the activity pane and replies only `Opened Codex activity.` It no longer prints a duplicate worker list or opaque agent IDs. Routine launch, stop, startup, and child-activity notices also avoid IDs; stop feedback names the task. IDs remain in structured runtime records and explicitly expanded diagnostics. Missing stop arguments direct users to the pane's Stop Codex button.

The source Mod tests pass **14/14**, including the command-output regression and ID-free progress notices. The focused panel/bundle Node tests pass **14/14**, including deterministic generation and an isolated bundle run. An actual isolated Claude terminal trial with simulated Codex verified the short acknowledgement at 160 and 48 columns. The captured renderer files are byte-identical to this final staged revision; its different hash reflects the finalized tests. The prior full **129/129** Node result remains the broader baseline; it was not repeated for these presentation-only changes. The installed package remains untouched.

---

# Activity panel polish (2026-10-06)

The polished `0.2.4` candidate supersedes the first layout candidate below. The current package at `output/codex-agent-layout-staging` is `1.0.6-native.0.2.4.h600c2e104485`.

Every active agent now has a task subtitle beneath its model/thinking header, including agents that are not selected. The selected activity remains attached to that row. Compact display combines start/completion and output updates using typed thread, turn, item, and activity identities; separate commands and child threads remain distinct. Expanded display retains the original events and reveals agent/thread IDs. Controls share a row and wrap. Short panes reduce page size and recent-event count so the folded history remains reachable; narrow headers retain model, thinking level, and status.

History is ordered by completion with the newest first, and its folded heading reports failures. The `p` shortcut toggles history. Paging selects a visible row and stops at the first/last page. Roster changes keep the selected active agent on screen. Expansion is remembered per agent, with parent and worker views owning separate selection. A worker's own view retains its activity when it finishes; the parent continues to prioritize active work.

Validation passed: **129/129 Node tests** in 131.8 seconds, **13/13 source Mod tests**, **13/13 staged Mod tests**, source/staged TypeScript checks, strict marketplace/plugin validation, deterministic bundle regeneration, and `git diff --check`. Regression coverage includes page-boundary completion, per-view selection and expansion, completion ordering, interrupted resumption, identity-safe activity compression, narrow headers, and shorter viewports.

The staged package passed all four real Claude lifecycle scenarios with simulated Codex and zero Claude model requests: foreground implementation (`2036fce6-1a22-4405-a5a7-cca73644211a`), background report retrieval (`32485f85-4987-4bd1-90af-7c8afc9bee1b`), TaskStop (`a9edc2d6-c476-4202-8c75-4e9336b0ff3b`), and activity-only watchdog protection (`c46e15ba-c1ab-4043-955c-3c5e4984f119`). All owned app-server processes exited.

A separate isolated Claude Code 2.1.292 terminal trial exercised two running workers and one completed worker, opened/folded history with its actual keyboard shortcut, and resized from 160 to 48 columns. It captured the actual terminal cells with simulated Codex and blocked Claude provider requests. The final trial verified that the folded history stays visible at 48 columns. Captures are in `output/codex-agent-layout-preview`. An earlier narrow capture exposed the clipped footer and led to the adaptive height change. The first attempts did not render an automatically opened pane below Claude's 144-column unrequested-pane threshold; using a wide terminal and the explicit status command resolved this test setup issue. Those failed capture attempts are not counted as successful visual checks.

The installed `0.2.3` package and running user sessions remain untouched. Apply the update after finishing active work and closing Claude, as described in `SINGLE-PLUGIN.md`.

---

# Active agents and folded history (2026-10-06)

The `0.2.4` candidate is staged in `output/codex-agent-layout-staging` as `1.0.6-native.0.2.4.h2a40403f560e`. Active agents appear before a folded **Previous agents** list. Starting, running, and stopping agents remain active; completed, failed, and interrupted agents enter history. Each group pages independently in sets of five. Opening a finished worker's own view reveals its history entry.

Active row headers show the runtime's resolved model, thinking effort, and status. Explicit turn effort takes precedence over the thread's configured effort; unresolved effort displays `default`. The selected task and activity appear directly within that row, without a repeated activity heading. When the selected worker finishes while history is folded, the pane selects another active worker or shows the folded history alone.

Validation passed: **117/117 Node tests**, **12/12 source Mod tests**, and **12/12 staged Mod tests** on terminal and desktop test surfaces. Coverage includes mixed terminal states, live completion transitions, default-folded history, independent pagination, attached activity, a single model header, explicit/default effort metadata, stop-in-progress classification, and terminal control sanitization. Source and staged TypeScript checks, strict plugin/marketplace validation, deterministic bundle regeneration, and `git diff --check` passed.

The staged bundle also passed all four real Claude lifecycle scenarios with simulated Codex and zero Claude model requests: foreground implementation (`d5438b3c-b4c1-478a-8f6e-b4979b2fd08c`), background report retrieval (`0394ece7-649f-423b-8bc4-bce4040d0246`), TaskStop (`372bc41b-711a-44c6-9a44-0fbe1bab49a0`), and activity-only watchdog protection (`27eb318e-c0f8-4d49-99e6-9c0cf899e544`). All owned app-server processes exited. These are lifecycle and renderer checks, not a visual trial in the user's current session.

The installed local marketplace is still `0.2.3`, and a Claude session is running. The candidate does not replace its live package. Finish delegated work and close Claude sessions before rebuilding the local marketplace and applying the update described in `SINGLE-PLUGIN.md`.

---

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
