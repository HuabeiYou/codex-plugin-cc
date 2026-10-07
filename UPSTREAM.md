# Upstream provenance

Codex Companion is derived from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) under Apache-2.0. Base: version **1.0.6**, commit [`db52e28f4d9ded852ab3942cea316258ae4ef346`](https://github.com/openai/codex-plugin-cc/commit/db52e28f4d9ded852ab3942cea316258ae4ef346), July 7, 2026 Pacific time.

This fork adds native Claude workers, live activity/cancellation, persistent topic feedback, host-handoff recovery, recoverable cleanup, and independent release packaging. Fork releases are maintained independently. Upstream LICENSE and NOTICE remain in source and distributable packages.

Maintained code is in `plugins/codex` and `plugins/codex-native-prototype`; `release/` is generated. The `codex` command namespace is retained. This marketplace is `codex-companion`; OpenAI's is `openai-codex`.
