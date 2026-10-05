---
name: codex-result-handling
description: Internal guidance for presenting Codex helper output back to the user
user-invocable: false
---

# Codex Result Handling

When the helper returns Codex output:
- Preserve the helper's verdict, summary, findings, and next steps structure.
- For review output, present findings first and keep them ordered by severity.
- Use the file paths and line numbers exactly as the helper reports them.
- Preserve evidence boundaries. If Codex marked something as an inference, uncertainty, or follow-up question, keep that distinction.
- Preserve output sections when the prompt asked for them, such as observed facts, inferences, open questions, touched files, or next steps.
- If there are no findings, say that explicitly and keep the residual-risk note brief.
- If Codex made edits, say so explicitly and list the touched files when the helper provides them.
- For `codex:codex-rescue`, do not turn a failed or incomplete Codex run into a Claude-side implementation attempt disguised as Codex output. The parent applies `codex-job-supervision`, reads errors and partial work, and continues only within the user's authorized scope.
- For `codex:codex-rescue`, if Codex was never successfully invoked, do not generate a substitute answer at all.
- For a review-only request, present the findings and finish without code changes. If the current user request already authorizes fixes, the parent may use review feedback to continue that authorized work. Ask for approval only for work outside the existing scope.
- If the helper reports malformed output or a failed Codex run, preserve the most actionable stderr lines. The parent handles that failure under `codex-job-supervision`; it does not guess a successful result.
- If the helper reports that setup or authentication is required, direct the user to `/codex:setup` and do not improvise alternate auth flows.
