# Try a local Codex Companion candidate

The public marketplace selects the committed combined package at `release/plugins/codex`. A local candidate uses the same package and `codex@codex-companion` identity.

```bash
npm ci
npm run release:prepare
npm run release:validate
npm run release:test
```

The builder excludes generated host SDK declarations; acceptance obtains fresh declarations in a temporary copy. A fresh checkout needs no interactive session to bootstrap types.

Finish delegated work and close Claude sessions before changing installed packages. If present, uninstall `codex@openai-codex` or the older `codex@huabei-codex` with `--scope user --keep-data`. Register the local standalone marketplace:

```bash
claude plugin marketplace add "$PWD/release"
claude plugin install codex@codex-companion --scope user
claude plugin list
```

Keep only one Codex plugin enabled. If `codex-companion` is already registered from GitHub, remove that marketplace registration before adding the local one, or use the published update procedure. Start a new Claude session, run `/codex:setup`, and use `codex:worker` or `/codex:rescue`. The [README](README.md) describes permissions, qualification, and rollback.

For source development, `npm run prototype` loads the native component as `codex-native-prototype:worker` alongside its companion source. `npm run bundle` retains the hash-versioned field-test builder under `output/codex-local-marketplace`; it does not install anything.

Edit maintained sources and regenerate `release/`; `npm run release:check` detects stale output and verifies that the root marketplace selects the combined plugin. Never rebuild a local package while a Claude session is using it.
