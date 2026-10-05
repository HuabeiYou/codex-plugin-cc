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
