# Replace the official plugin with this fork

The field-test bundle is one plugin, `codex@huabei-codex`. It contains the patched companion runtime and the native Mod. Its worker is `codex:worker`, using the full rescue runtime with file edits, long tasks, saved threads, and live activity. Claude supervises its agents and reads their feedback automatically; progress views remain optional.

Finish or stop active delegated work and close Claude Code sessions before rebuilding. Claude may read this local package directly during a session. Build and validate the package from this repository:

```bash
npm run bundle:validate
npm run bundle:test
```

The bundle retains the generated Mod API declarations from the native plugin for TypeScript validation. On a fresh checkout, load the native plugin once with `npm run prototype` to generate those declarations before running the bundle checks.

For a first installation, run these commands in your terminal:

```bash
claude plugin marketplace add "$PWD/output/codex-local-marketplace"
claude plugin uninstall codex@openai-codex --scope user --keep-data
claude plugin install codex@huabei-codex --scope user
claude plugin list
```

The Codex entry should be `codex@huabei-codex`, enabled at user scope. The official `codex@openai-codex` entry should be absent. The official marketplace can remain registered; a marketplace is a catalog, not another active plugin. The uninstall preserves official plugin data and does not uninstall the Codex CLI or change its model credentials.

Start Claude normally in the project you want to work on:

```bash
claude
```

No `--plugin-dir` flags are needed. Ask Claude to use `codex:worker` for implementation, debugging, or review. Claude keeps a conversation per topic: implementation adjustments and re-reviews return to their original workers with `SendMessage`; new topics and independent reviews get fresh workers. `/codex:rescue`, `/codex:review`, and `/codex:adversarial-review` use that lifecycle, with read-only review conversations. The activity pane opens automatically, and `/codex-native-status` reopens it. Opening the worker from Claude's agent list shows its own activity notices. The main transcript keeps the ordinary Agent row and completion feedback.

The worker uses rescue's workspace-write sandbox by default and can edit project files. Claude selects explicit read-only scope when the task requires it. Workers stay attached until completion, with no fixed task-duration cap. Claude reads their native completion feedback automatically. Opening Claude's agents view preserves the worker identity and resumes its exact interrupted Codex thread after Claude's session handoff. Arbitrary exit/restart recovery is still outside this guarantee.

Completed plugin-owned conversations are archived recoverably when the session ends with its workers idle. Their history and reports remain saved; later feedback unarchives and continues the exact conversation. Cleanup excludes active or interrupted workers and other sessions' conversations. Exit-time cleanup is best effort.

Keep the generated local marketplace at its current path for this trial. To update from later source changes, first finish or stop delegated work and close Claude Code. Then rebuild, refresh the marketplace, and update:

```bash
npm run bundle:validate
npm run bundle:test
claude plugin marketplace update huabei-codex
claude plugin update codex@huabei-codex
```

Restart Claude after an update. The generated version includes a source hash, so source changes produce a new installable revision. The generator never changes the installed plugin configuration. If you need to return to the official integration:

```bash
claude plugin uninstall codex@huabei-codex --scope user --keep-data
claude plugin install codex@openai-codex --scope user
```

This is a local field-test package. Generate it with `scripts/build-single-plugin.mjs`; do not edit the generated files. The generator preserves the upstream settings hooks, adds the native hook module, rewrites native agent references into the `codex` namespace, and includes the shared app-server client inside the package.
