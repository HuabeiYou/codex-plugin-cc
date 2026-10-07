# Codex Companion for Claude Code

An independent Apache-2.0 fork of https://github.com/openai/codex-plugin-cc, maintained by HuabeiYou. Not affiliated with or endorsed by OpenAI or Anthropic.

One plugin combines the companion runtime and native Mod. Claude supervises Codex workers and reads their feedback automatically. Codex runs its own local harness, using your existing Codex authentication and configuration.

Use `codex:worker` for implementation, investigation, or review with live activity. Follow-ups and re-reviews return to their original topic worker through SendMessage. `/codex:rescue`, `/codex:review`, and `/codex:adversarial-review` use this lifecycle; reviews remain read-only. `/codex-native-status` opens the activity pane. Stop an owned worker from its pane or Claude task controls.

Implementation uses workspace-write and approvalPolicy: never; review uses read-only. The plugin does not forward interactive Codex approval prompts. Completed idle conversations are archived recoverably on session end. Arbitrary exit/restart restoration is not guaranteed.

Beta qualification: macOS, Claude Code 2.1.292, Codex CLI 0.160.0, Node 24.16.0. Claude function hooks are an early-access API. Linux, Windows, and other host versions are not qualified for this release.

Installation, updates, and release evidence: https://github.com/HuabeiYou/codex-plugin-cc
