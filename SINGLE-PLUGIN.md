# Replace the official plugin with this fork

The field-test bundle is one plugin, `codex@huabei-codex`. It contains the patched companion runtime and the native Mod. Its native worker is `codex:worker`. Claude supervises its agents and reads their feedback automatically; progress views remain optional.

Build and validate the package from this repository:

```bash
npm run bundle:validate
npm run bundle:test
```

Finish or stop any active delegated work, then close existing Claude Code sessions. Run these commands in your terminal:

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

No `--plugin-dir` flags are needed. Ask Claude to use `codex:worker` for native read-only investigation or review. `/codex-native-status` opens the optional activity pane. Existing `/codex:rescue`, `/codex:review`, and other companion commands remain available in the same plugin. Native tasks remain read-only, have a two-minute connected-task limit, and cannot resume across session restarts; companion rescue retains its existing write-capable behavior when authorized.

Keep the generated local marketplace at its current path for this trial. To update from later source changes, rebuild it, refresh the marketplace, and update the installed plugin:

```bash
npm run bundle:validate
claude plugin marketplace update huabei-codex
claude plugin update codex@huabei-codex
```

Restart Claude after an update. The generated version includes a source hash, so source changes produce a new installable revision. The generator never changes the installed plugin configuration. If you need to return to the official integration:

```bash
claude plugin uninstall codex@huabei-codex --scope user --keep-data
claude plugin install codex@openai-codex --scope user
```

This is a local field-test package. Generate it with `scripts/build-single-plugin.mjs`; do not edit the generated files. The generator preserves the upstream settings hooks, adds the native hook module, rewrites native agent references into the `codex` namespace, and includes the shared app-server client inside the package.
