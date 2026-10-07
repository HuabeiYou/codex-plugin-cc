# Codex Companion for Claude Code

Run Codex as native `codex:worker` agents inside Claude Code, with live activity, cancellation, and persistent conversations per topic. Claude supervises and reads completion reports; Codex uses your existing CLI authentication and configuration.

An independent Apache-2.0 fork of [OpenAI's Codex plugin](https://github.com/openai/codex-plugin-cc), not affiliated with or endorsed by OpenAI or Anthropic.

## Install

Requires Node.js 22+ and Claude Mods/function-hook support. This beta is qualified on **macOS, Claude Code 2.1.292, Codex CLI 0.160.0, and Node.js 24.16.0**.

```bash
claude plugin marketplace add HuabeiYou/codex-plugin-cc
claude plugin install codex@codex-companion --scope user
```

Start a new Claude session and run `/codex:setup`. No source build is needed. Keep only one Codex plugin enabled: when replacing the official plugin, finish delegated work, close Claude, and run `claude plugin uninstall codex@openai-codex --scope user --keep-data` first.

Setup can offer to install Codex for you. Authenticate with `codex login` in your terminal or `!codex login` in Claude Code, unless your custom provider is already configured.

## Use

```text
/codex:review --base main
/codex:adversarial-review --base main examine cancellation and retry behavior
/codex:rescue investigate the failing build
```

Follow-ups and re-reviews return to the exact worker and Codex thread for that topic. New topics get separate workers. Model and effort defaults come from Codex unless explicitly selected; for example, add `--model gpt-6.1-sol --effort high` to a rescue request.

| Command | Purpose |
| --- | --- |
| `/codex:review [--base <ref>]` | Read-only review of local or branch changes |
| `/codex:adversarial-review [--base <ref>] <focus>` | Read-only challenge review with custom focus |
| `/codex:rescue <task>` | Delegate implementation or investigation |
| `/codex:transfer` | Import the current Claude conversation into a resumable Codex thread |
| `/codex:status`, `/codex:result` | Inspect tracked jobs or their saved reports |
| `/codex:cancel` | Cancel an owned tracked job |
| `/codex:setup` | Check CLI readiness and configure the optional review gate |

Open a worker in Claude's agent list to inspect its activity. `/codex-native-status` opens the activity pane; **Stop Codex** or Claude's task controls cancel that worker.

## Update

Finish delegated work, close Claude, then run:

```bash
claude plugin marketplace update codex-companion
claude plugin update codex@codex-companion
```

Restart Claude. See [rollback instructions](docs/RELEASING.md#rollback) to return to the official plugin.

## Beta limits

Implementation uses `workspace-write` with `approvalPolicy: never`; reviews use `read-only`. Interactive Codex approval prompts are not forwarded. Work consumes your Codex provider's usage as well as the supervising Claude session's usage.

The optional review gate is off by default. Enable it with `/codex:setup --enable-review-gate` or disable it with `/codex:setup --disable-review-gate`; repeated review/fix rounds consume more usage.

Function hooks are early access. Linux/Windows native UI, other host versions, desktop layout, crash recovery, live Claude delegation adherence, and cache savings are not qualified. Completed idle conversations archive recoverably on session end; cleanup is best effort. See [release evidence](docs/releases/1.1.0-beta.1.md).

For development, see [local installation](SINGLE-PLUGIN.md), [release procedure](docs/RELEASING.md), and [upstream provenance](UPSTREAM.md). Report problems through [GitHub issues](https://github.com/HuabeiYou/codex-plugin-cc/issues), including versions and reproducible steps; redact private logs.
