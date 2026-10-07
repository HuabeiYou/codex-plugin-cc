---
description: Challenge a plan or implementation with a persistent Codex reviewer
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Bash(git:*), Agent, SendMessage, TaskOutput, TaskStop, Skill
---

Apply `codex:codex-native-supervision`. This request is review-only: delegate with `write: false` and return the full review without applying fixes.

User request:
$ARGUMENTS

Start a separate `codex:worker` for a new adversarial review topic. For re-review after changes addressing an existing review, use `SendMessage` to that original reviewer. Retain the review topic and its worker handle separately from implementation workers. Include the changed plan or implementation and ask which prior findings are resolved, still open, or newly introduced.

Ask Codex to challenge the approach, assumptions, tradeoffs, failure paths, retries, concurrency, permission boundaries, rollback, and observability. Require material, grounded findings with evidence, impact, and a concrete remedy. For implementation findings, include verified file and line locations; for a plan, refer to the relevant plan section. Inspect current files and diffs each round. Report a clear assessment when there are no supported findings.

Preserve the user's focus and target. `--base` selects the branch diff against that reference; working-tree scope includes staged, unstaged, and untracked changes. Auto scope selects working-tree changes when present, otherwise the branch diff against its base. `--scope staged` and `--scope unstaged` are unsupported. When reviewing a supplied plan, pass that plan directly. Use foreground for `--wait`, background for `--background`, and otherwise background for substantial reviews. Keep routing flags out of the review text. Read the completed report automatically.
