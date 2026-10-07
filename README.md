# Codex Companion for Claude Code

Run the actual Codex harness as native workers inside Claude Code, with live activity, cancellation, and persistent conversations per topic.

An independently maintained Apache-2.0 fork of [OpenAI's Codex plugin](https://github.com/openai/codex-plugin-cc). Not affiliated with or endorsed by OpenAI or Anthropic. Claude supervises; your existing Codex CLI executes the work with its own tools, authentication, and configuration.

## What it adds

- Native `codex:worker` agents for implementation, debugging, and independent review.
- Live activity showing task, model, reasoning effort, progress, and stop controls.
- Automatic completion feedback and report retrieval by Claude.
- Follow-ups and re-reviews that return to the exact worker and Codex thread for that topic.
- Recoverable archival of completed idle conversations when the Claude session ends.

The original setup, transfer, status, result, cancel, and optional review-gate commands remain available. Review commands use native read-only workers in this distribution.

## Beta requirements

Qualified on **macOS with Claude Code 2.1.292, Codex CLI 0.160.0, and Node.js 24.16.0**. Requires Node.js 22 or newer and Claude Mods/function-hook support. Organization policy may restrict Mods. Linux, Windows, other Claude/Codex versions, and interactive desktop layout are not qualified for this beta.

You need an installed, configured `codex` CLI and access through your existing Codex login or provider. Delegated work consumes that provider's usage; the normal Claude parent also consumes Claude usage. Model and effort defaults come from Codex unless explicitly selected.

## Install

Finish delegated work and close existing Claude sessions before replacing another Codex plugin. If the official plugin is installed, remove it while preserving data:

```bash
claude plugin uninstall codex@openai-codex --scope user --keep-data
```

If you used the previous local trial, remove `codex@huabei-codex` with the same options. Install this fork:

```bash
claude plugin marketplace add HuabeiYou/codex-plugin-cc
claude plugin install codex@codex-companion --scope user
```

Start a new Claude session and run `/codex:setup`. No source build or npm dependencies are needed to install the plugin. Keep only one Codex plugin enabled in each session. For an unpublished candidate, follow [local installation](SINGLE-PLUGIN.md).

`/codex:setup` can offer to install Codex for you. You can also install it with `npm install -g @openai/codex`. If it needs authentication, run `codex login` in your terminal or `!codex login` from Claude Code. An already configured custom Codex provider keeps its existing authentication.

## Use

```text
Use codex:worker to implement this fix and run the relevant tests.

/codex:review --base main
/codex:adversarial-review --base main examine cancellation and retry behavior
/codex:rescue investigate the failing build
/codex:rescue --model gpt-6.1-sol --effort high investigate the failing build
```

Claude reads the completion report automatically. Send adjustments or request re-review in the same conversation; Claude retains the original topic worker. New topics and independent reviewers get separate workers.

| Command | Purpose |
| --- | --- |
| `/codex:review [--base <ref>]` | Read-only review of local or branch changes |
| `/codex:adversarial-review [--base <ref>] <focus>` | Read-only challenge review with custom focus |
| `/codex:rescue <task>` | Delegate implementation or investigation |
| `/codex:transfer` | Import the current Claude conversation into a resumable Codex thread |
| `/codex:status`, `/codex:result` | Inspect tracked jobs or their saved reports |
| `/codex:cancel` | Cancel an owned tracked job |
| `/codex:setup` | Check CLI readiness and configure the optional review gate |

The activity pane opens automatically when the terminal has room. `/codex-native-status` opens it explicitly. Open a worker in Claude's agent list to inspect its activity. Use **Stop Codex** in the pane or Claude's task controls to cancel that worker.

Implementation uses Codex's `workspace-write` sandbox with `approvalPolicy: never`; review uses `read-only`. Interactive Codex approval requests are not forwarded. Delegated tasks should fit these execution boundaries. The optional stop review gate is off by default; enabling it can produce repeated review/fix rounds and consume more usage.

Use `/codex:setup --enable-review-gate` to enable that gate or `/codex:setup --disable-review-gate` to turn it off.

## Update or roll back

Finish or stop delegated work, close Claude sessions, and run:

```bash
claude plugin marketplace update codex-companion
claude plugin update codex@codex-companion
```

Restart Claude. To return to the official integration:

```bash
claude plugin uninstall codex@codex-companion --scope user --keep-data
claude plugin marketplace add openai/codex-plugin-cc
claude plugin install codex@openai-codex --scope user
```

`--keep-data` preserves plugin data. Removing the plugin does not uninstall Codex or change provider credentials.

## Limits and evidence

Function hooks are early access and can change between releases. Agents-view handoff is covered; automatic restoration after an arbitrary crash, exit, or restart is not guaranteed. Session-end archival is best effort and excludes active or interrupted workers. Conversation reuse preserves thread identity; it does not guarantee cache hits or lower cost.

See [beta release notes](docs/releases/1.1.0-beta.1.md) and [historical acceptance](plugins/codex-native-prototype/ACCEPTANCE.md). Simulated Codex tests establish lifecycle behavior, not provider quality. Real-provider tests with a scripted Claude parent do not establish whether a live Claude model follows the delegation instructions reliably.

## Development

Sources live in `plugins/codex` (companion runtime) and `plugins/codex-native-prototype` (native worker). `release/` is generated and committed so GitHub marketplace installs need no build.

```bash
npm ci
npm test
npm run build
npm run release:prepare
npm run release:validate
npm run release:test
npm run release:pack
```

`release:test` exercises Claude's actual Agent lifecycle with simulated Codex, then typechecks against fresh API declarations generated in an isolated copy. It needs Claude Code but no provider calls or existing user configuration. `release:acceptance:real` runs the implementation/follow-up/re-review trial using your configured Codex provider and consumes usage. Packaging requires Python 3. See [the release procedure](docs/RELEASING.md).

Report reproducible problems through [GitHub issues](https://github.com/HuabeiYou/codex-plugin-cc/issues), including versions, task, and observed behavior. Redact credentials and private task content from logs.
