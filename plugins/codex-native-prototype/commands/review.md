---
description: Review local changes with a persistent Codex reviewer
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]'
disable-model-invocation: true
allowed-tools: Read, Bash(git:*), Agent, SendMessage, TaskOutput, TaskStop, Skill
---

Apply `codex-native-prototype:codex-native-supervision`. This request is review-only: delegate with `write: false` and return the full review without applying fixes.

User request:
$ARGUMENTS

Start a separate `codex-native-prototype:worker` for a new review topic. For re-review of changes addressing an existing review, use `SendMessage` to its original reviewer. Keep its worker handle separate from implementation workers. Ask which prior findings are resolved, still open, or newly introduced.

Ask Codex to inspect current repository state, trace affected behavior, and report actionable defects with verified file and line locations, trigger, impact, and a concrete remedy. Inspect current files and diffs every round. Report when there are no supported findings.

`--base` selects the branch diff against that reference; working-tree scope includes staged, unstaged, and untracked changes. Auto scope selects working-tree changes when present, otherwise the branch diff against its base. Staged-only, unstaged-only, and extra focus text are unsupported here; custom focus belongs in adversarial review. Use foreground for `--wait`, background for `--background`, and otherwise background for substantial reviews. Keep routing flags out of the review text. Read the completed report automatically.
