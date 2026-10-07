// Claude manages the Agent; the shared rescue runtime executes its task.
import { createRun, acceptEvent, readEvents, finalAnswer, displayText, setRunStatus } from './protocol.mjs';
import { PaneState, paneActivity, displayLine, agentHeader, PAGE_SIZE } from './panel.mjs';

const runs = new Map();
const spawnRows = new Map();
const PANE_ID = 'codex-native-activity';
const AGENT_TYPE = 'codex:worker';
const paneStates = new Map();

/** @returns {import('claude-code').TurnStepResult} */
function stepResult(e, answer) {
  return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null };
}

function activityText(run, event) {
  if (event.kind === 'ready') return `Codex${run.model ? ' (' + run.model + ')' : ''} started.`;
  if (event.kind === 'activity') return `${event.threadId && event.threadId !== run.threadId ? '↳ ' : ''}${event.label} [${event.status}]`;
  return null;
}

async function recordActivity($, run, text) {
  if (!text) return;
  try {
    // A notice is visible in this child's transcript and adds no model input.
    const stored = await $.session.append({ agentId: run.agentId,
      message: { type: 'system', content: [{ type: 'text', text }] } });
    if (stored.deny) throw new Error(stored.deny);
  } catch (error) {
    // A display failure must not interrupt implementation work.
    run.noticeError = error instanceof Error ? error.message : String(error);
  }
}

function workerAnswer(run) {
  return finalAnswer(run) + (run.noticeError ? `\n\nCodex activity display was unavailable: ${run.noticeError}` : '');
}

async function stopRun($, run) {
  if (run.status !== 'running' && run.status !== 'starting') return;
  const result = await $.process.run(['node', `${$.plugin.root}/scripts/native-bridge.mjs`, 'cancel', run.id]);
  if (result.exitCode !== 0) { $.ui.toast('Could not stop Codex: ' + result.stderr); return; }
  if (JSON.parse(result.stdout).requested) {
    setRunStatus(run, 'stopping');
    $.ui.invalidate('ui.render');
  }
}

/** @returns {import('claude-code').RenderElement} */
function renderActivity($, e, run, state, compactLimit) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const expanded = state.expandedAgents.has(run.agentId);
  const activity = paneActivity(run, expanded, compactLimit);
  return /** @type {import('claude-code').RenderElement} */ (h(Box, { flexDirection: 'column' },
    ...(expanded ? [h(Text, { key: `identity-${run.agentId}`, dimColor: true, wrap: 'truncate-end' },
      displayText(`Agent ${run.agentId} · Thread ${run.threadId || 'starting'}`))] : []),
    ...activity.map((entry) => h(Text, { key: entry.key, dimColor: entry.dim,
      ...(entry.failed ? { color: 'red' } : {}), wrap: expanded ? 'wrap' : 'truncate-end' }, entry.text)),
    ...(!activity.length && (expanded || compactLimit > 0) ? [h(Text, { dimColor: true }, run.status === 'starting' ? 'Starting Codex…'
      : run.status === 'running' ? 'Waiting for activity…' : run.status === 'stopping' ? 'Stopping Codex…' : 'No activity recorded.')] : []),
    ...(run.error && run.status !== 'interrupted' ? [h(Text, { color: 'red', wrap: 'wrap' }, displayText(run.error))] : []),
    h(Box, { key: `actions-${run.agentId}`, flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
      ...(run.activity.length ? [h(Button, { key: 'expand-activity', label: expanded ? 'Compact activity' : 'Expand activity',
        onPress: () => { state.toggleActivity(run.agentId); $.ui.invalidate('ui.render'); } })] : []),
      ...(run.status === 'running' || run.status === 'starting' ? [h(Button, {
        key: `stop-${run.id}`, label: 'Stop Codex', onPress: () => stopRun($, run)
      })] : [])
    )
  ));
}

/** @type {import('claude-code').Register} */
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'codex-native', description: 'Delegate a task to the native Codex worker', argumentHint: '<task>', immediate: true });
    await $.command.register({ name: 'codex-native-status', description: 'Show native Codex agents and open their activity', immediate: true });
    await $.command.register({ name: 'codex-native-stop', description: 'Stop a native Codex agent', argumentHint: '<agent-id>', immediate: true });
    const result = await next(e);
    const ready = await $.process.run(['node', `${$.plugin.root}/scripts/native-ready-server.mjs`, '--mark']);
    if (ready.exitCode !== 0) throw new Error(`Could not publish Codex Mod readiness: ${ready.stderr}`);
    return result;
  });
  on('session.end', async ($, e, next) => {
    // A host handoff can end one session while its workers are being adopted.
    // Archive only fully delivered work, after all owned workers are idle.
    if (e.reason !== 'resume' && ![...runs.values()].some((run) => ['starting', 'running', 'stopping'].includes(run.status))) {
      const runIds = /** @type {string[] | undefined} */ (await $.store.get(`native-workers:${e.sessionId}`));
      if (runIds?.length) {
        try {
          await $.process.run(['node', `${$.plugin.root}/scripts/native-bridge.mjs`, 'archive', JSON.stringify({ runIds, sessionId: e.sessionId })], {
            env: { CODEX_COMPANION_SESSION_ID: e.sessionId }
          });
        } catch { /* Cleanup is best effort; retained checkpoints remain resumable. */ }
      }
    }
    try { await $.process.run(['node', `${$.plugin.root}/scripts/native-ready-server.mjs`, '--clear']); }
    catch { /* The host may already be shutting down. Its identity expires. */ }
    return next(e);
  });

  on('session.receive', async ($, e, next) => {
    if (!e.agentId) return next(e);
    const key = `native-run:${e.agentId}`;
    const saved = /** @type {{ id?: string, feedback?: Array<{ id: string, prompt: string }> } | undefined} */ (await $.store.get(key));
    if (!saved?.id) return next(e);
    const feedback = { id: crypto.randomUUID(), prompt: e.text };
    await $.store.set(key, { ...saved, feedback: [...(saved.feedback || []), feedback] });
    const delivered = await next(e);
    if (delivered.consumed) {
      const current = /** @type {typeof saved} */ (await $.store.get(key));
      if (current) await $.store.set(key, { ...current, feedback: (current.feedback || []).filter((item) => item.id !== feedback.id) });
    }
    return delivered;
  });

  on('agent.spawn', { subagentType: AGENT_TYPE }, async ($, e, next) => {
    const spawned = await next(e);
    if (spawned.agentId) {
      spawnRows.set(spawned.agentId, { toolUseId: e.tool_use_id, prompt: e.prompt, cwd: e.cwd });
      let run = runs.get(spawned.agentId);
      if (!run) { run = createRun(spawned.agentId, e.description || 'Codex task', crypto.randomUUID()); runs.set(spawned.agentId, run); }
      run.toolUseId = e.tool_use_id;
      $.ui.invalidate('ui.render');
    }
    return spawned;
  });

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const response = await next(e);
    if (response.deny !== undefined || response.isError) return response;
    const result = /** @type {{ agentId?: string, isAsync?: boolean, outputFile?: string, canReadOutputFile?: boolean } | undefined} */ (response.result);
    if (!result?.agentId || !result.isAsync) return response;
    const run = runs.get(result.agentId);
    if (!run) return response;
    // Mod-supplied answers do not create Claude's usual child transcript file.
    // Give the parent an actual report artifact through the ordinary Agent handle.
    const outputFile = result.outputFile;
    if (!outputFile) return response;
    const bound = await $.process.run(['node', `${$.plugin.root}/scripts/native-bridge.mjs`, 'bind-output', run.id, outputFile, result.agentId],
      { env: { CODEX_COMPANION_SESSION_ID: await $.session.id() } });
    if (bound.exitCode !== 0) throw new Error(`Could not bind Codex report: ${bound.stderr}`);
    return response;
  });

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const run = runs.get(e.task_id);
    if (run && (run.status === 'running' || run.status === 'starting')) {
      let release = (_value) => {};
      run.stopGate = new Promise((resolve) => { release = resolve; });
      // Let Codex acknowledge turn/interrupt before Claude kills its wrapper.
      // A timeout still proceeds to the harness's own stop/kill path.
      try {
        await $.process.run(['node', `${$.plugin.root}/scripts/native-bridge.mjs`, 'cancel', run.id, '--wait']);
        return await next(e);
      } finally { release(undefined); run.stopGate = null; }
    }
    return next(e);
  });

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) return yield* next(e);
    const agents = await $.agent.list();
    const agent = agents.find((candidate) => candidate.id === e.agentId && candidate.type === AGENT_TYPE);
    if (!agent) return yield* next(e);
    const saved = /** @type {{ id?: string, pluginData?: string, prompt?: string, requestId?: string, inputSignature?: string, feedback?: Array<{ id: string, prompt: string }> } | undefined} */ (await $.store.get(`native-run:${e.agentId}`));
    const messages = await $.session.messages({ agentId: e.agentId });
    const inputs = Array.isArray(messages) ? messages.filter((message) => message.role === 'user' && message.text.trim()) : [];
    const latestInput = inputs[inputs.length - 1]?.text;
    const inputSignature = latestInput ? JSON.stringify([inputs.length, latestInput]) : saved?.inputSignature;
    const freshInput = Boolean(saved?.inputSignature && inputSignature !== saved.inputSignature);
    const pending = saved?.feedback || [];
    let run = runs.get(e.agentId);
    if (run?.started && run.claudeTurnId === e.turnId && !pending.length && !freshInput) {
      // Never rerun a Codex task if Claude's loop unexpectedly requests a retry.
      const answer = workerAnswer(run);
      yield { kind: 'text', index: 0, text: answer };
      yield { kind: 'stop', stopReason: 'end_turn', usage: null };
      return stepResult(e, answer);
    }
    run ??= createRun(e.agentId, agent.description, crypto.randomUUID());
    // Claude's agents view checkpoints a child and resumes it in another host.
    // Keep the bridge identity across that handoff, scoped to this plugin/agent.
    if (saved?.id) { run.id = saved.id; run.pluginData = saved.pluginData; }
    run.started = true;
    run.claudeTurnId = e.turnId;
    setRunStatus(run, 'starting');
    run.result = null;
    run.error = null;
    run.answer = '';
    runs.set(e.agentId, run);
    const row = spawnRows.get(e.agentId);
    run.toolUseId = row?.toolUseId ?? null;
    let streamed = '';
    let buffer = '';
    let stderr = '';
    let stream;
    try {
      const prompt = pending.length ? pending.map((item) => item.prompt).join('\n\n')
        : freshInput ? latestInput : saved?.prompt || row?.prompt || latestInput;
      const requestId = pending.length ? pending[pending.length - 1].id : freshInput ? crypto.randomUUID() : saved?.requestId || crypto.randomUUID();
      if (!prompt) throw new Error('The native agent task could not be read.');
      const sessionId = await $.session.id();
      if (!run.pluginData) {
        const location = await $.process.run(['node', `${$.plugin.root}/scripts/native-bridge.mjs`, 'report-path', run.id],
          { env: { CODEX_COMPANION_SESSION_ID: sessionId } });
        if (location.exitCode !== 0) throw new Error(`Could not resolve Codex data: ${location.stderr}`);
        run.pluginData = JSON.parse(location.stdout).pluginData;
      }
      // Persist restoration inputs before the task starts, including an early
      // agents-view switch that happens before its first ready event arrives.
      const current = /** @type {typeof saved} */ (await $.store.get(`native-run:${e.agentId}`));
      const claimed = new Set(pending.map((item) => item.id));
      await $.store.set(`native-run:${e.agentId}`, { id: run.id, pluginData: run.pluginData, prompt, requestId,
        inputSignature,
        feedback: (current?.feedback || []).filter((item) => !claimed.has(item.id)) });
      const owned = /** @type {string[] | undefined} */ (await $.store.get(`native-workers:${sessionId}`));
      await $.store.set(`native-workers:${sessionId}`, [...new Set([...(owned || []), run.id])]);
      // Real progress chunks reset Claude's watchdog; UI redraws do not.
      yield { kind: 'thinking', index: 0, text: 'Starting Codex.\n' };
      // Auto-open is optional inspection and must not hold a background task.
      $.ui.open({ id: PANE_ID, title: 'Codex activity' }).catch((error) => {
        run.noticeError = error instanceof Error ? error.message : String(error);
      });
      $.ui.invalidate('ui.render');
      stream = $.process.spawn({
        argv: ['node', `${$.plugin.root}/scripts/native-bridge.mjs`, 'run', run.id],
        cwd: row?.cwd || await $.session.cwd(),
        env: { CODEX_COMPANION_SESSION_ID: sessionId, ...(run.pluginData ? { CLAUDE_PLUGIN_DATA: run.pluginData } : {}) },
        input: JSON.stringify({ prompt, requestId })
      });
      while (true) {
        const chunk = await stream.next();
        if (chunk.done) {
          if (!run.result && !run.error) throw new Error(`Bridge exited (${chunk.value.code ?? chunk.value.signal}) without a result. ${stderr.slice(-1000)}`);
          break;
        }
        if (chunk.value.stream === 'stderr') { stderr = (stderr + chunk.value.text).slice(-4000); continue; }
        const parsed = readEvents(buffer, chunk.value.text);
        buffer = parsed.buffer;
        for (const event of parsed.events) {
          acceptEvent(run, event);
          if (event.kind === 'ready') {
            run.pluginData = event.pluginData;
          }
          const progress = activityText(run, event);
          if (progress && !next.signal.aborted) {
            yield { kind: 'thinking', index: 0, text: progress + '\n' };
            await recordActivity($, run, progress);
          }
          $.ui.invalidate('ui.render');
          if (event.kind === 'text' && !next.signal.aborted) {
            streamed += event.text;
            yield { kind: 'text', index: 1, text: event.text };
          }
        }
      }
      if (buffer.trim()) for (const event of readEvents(buffer, '', true).events) {
        acceptEvent(run, event);
        const progress = activityText(run, event);
        if (progress && !next.signal.aborted) {
          yield { kind: 'thinking', index: 0, text: progress + '\n' };
          await recordActivity($, run, progress);
        }
      }
      // TaskStop owns the agent's killed state. Keep this turn unfinished while
      // its caller waits for Codex cleanup, then lets Claude stop the child.
      if (run.stopGate) await new Promise((resolve, reject) => {
        const abort = () => reject(new Error('Native worker stopped by Claude.'));
        if (next.signal.aborted) return abort();
        next.signal.addEventListener('abort', abort, { once: true });
        run.stopGate.then(() => { next.signal.removeEventListener('abort', abort); resolve(undefined); });
      });
      if (next.signal.aborted) throw new Error('Native worker checkpointed by Claude.');
    } catch (error) {
      setRunStatus(run, next.signal.aborted ? 'interrupted' : 'failed');
      run.error = error instanceof Error ? error.message : String(error);
      // A checkpoint must leave an unfinished transcript. An end_turn answer
      // here makes Claude's adoption path consider the child already completed.
      if (next.signal.aborted) throw error;
    } finally {
      if (stream) await stream.return({ code: null, signal: 'SIGTERM' });
      $.ui.invalidate('ui.render');
    }
    const answer = workerAnswer(run);
    if (!streamed) yield { kind: 'text', index: 1, text: answer };
    else if (answer !== streamed) yield { kind: 'text', index: 1, text: answer.startsWith(streamed) ? answer.slice(streamed.length) : '\n\n' + answer };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return stepResult(e, answer);
  }).catch(async function* ($, e, next) {
    // A Mods budget/error must never silently send a native Codex task to Claude.
    const run = e.agentId ? runs.get(e.agentId) : null;
    if (!run) return yield* next(e);
    setRunStatus(run, next.signal.aborted ? 'interrupted' : 'failed');
    run.error = next.error.message;
    if (next.signal.aborted) throw next.error;
    const answer = workerAnswer(run);
    yield { kind: 'text', index: 0, text: answer };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return stepResult(e, answer);
  });

  on('turn.complete', async ($, e, next) => {
    const run = e.agentId ? runs.get(e.agentId) : null;
    if (run && e.isAborted) { setRunStatus(run, 'interrupted'); $.ui.invalidate('ui.render'); }
    return next(e);
  });

  on('command.run', { command: 'codex-native' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Usage: /codex-native <task>' };
    const spawned = await $.agent.spawn({ subagentType: AGENT_TYPE, prompt: e.args, description: e.args.slice(0, 60) });
    return { text: spawned.deny || 'Started Codex. Use /codex-native-status for activity.' };
  });
  on('command.run', { command: 'codex-native-status' }, async ($) => {
    await $.ui.open({ id: PANE_ID, title: 'Codex activity', focus: true });
    return { text: 'Opened Codex activity.' };
  });
  on('command.run', { command: 'codex-native-stop' }, async ($, e) => {
    const run = runs.get(e.args.trim());
    if (!run) return { text: 'Use Stop Codex in the activity pane, or supply an agent ID from expanded activity.' };
    await stopRun($, run);
    return { text: `${displayLine(run.description, 80)} · ${displayLine(run.status, 16)}` };
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    const workers = [...runs.values()];
    const viewId = e.props.view.agentId ?? null;
    if (!paneStates.has(viewId)) paneStates.set(viewId, new PaneState(viewId));
    const state = paneStates.get(viewId);
    const bodyRows = e.props.scroll.bodyRows;
    state.pageSize = Math.max(1, Math.min(PAGE_SIZE, Math.floor((bodyRows - 6) / 3)));
    const view = state.view(workers);
    // Keep headers, task subtitles, controls and folded history visible in a
    // short inline pane. Explicit expansion can use the host's scrolling.
    const reservedRows = 2 + view.activeRows.length * 3
      + (view.previous.length ? 2 : 0)
      + (state.historyOpen ? view.previousRows.length * 2 : 0)
      + (view.activePages > 1 ? 2 : 0)
      + (state.historyOpen && view.previousPages > 1 ? 2 : 0)
      + (e.props.bodyColumns < 38 ? 1 : 0);
    const compactLimit = Math.max(0, Math.min(6, bodyRows - reservedRows));
    const { Box, Text, Button } = $.ui.resolve(e);
    const renderRows = (group, history = false) => group.map((run, i) => {
      const selected = view.selected === run;
      return h(Box, { key: `worker-${run.agentId}`, flexDirection: 'column' },
        h(Button, { key: `select-${run.agentId}`, plain: true, dimColor: history && !selected,
          label: history ? `${selected ? '› ' : '  '}${displayLine(run.description, Math.max(16, e.props.bodyColumns - 24))} · ${displayLine(run.status, 16)}`
            : agentHeader(run, e.props.bodyColumns, selected),
          ...(!history ? { hotkey: String(i + 1) } : {}),
          onPress: () => { state.select(run); $.ui.invalidate('ui.render'); }
        }),
        h(Box, { flexDirection: 'column', paddingLeft: 3 },
          ...(!history ? [h(Text, { key: `task-${run.agentId}`, bold: selected, dimColor: !selected, wrap: 'truncate-end' },
            displayLine(run.description))] : []),
          ...(selected ? [renderActivity($, e, run, state, compactLimit)] : [])
        )
      );
    });
    const renderPages = (history, pages, page) => pages > 1 ? [h(Box, { flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
      ...(page > 0 ? [h(Button, { key: history ? 'previous-history' : 'previous-workers', label: 'Previous page', onPress: () => {
        state.page(history ? 'previous' : 'active', -1, workers); $.ui.invalidate('ui.render');
      } })] : []),
      h(Text, { dimColor: true }, `Page ${page + 1} of ${pages}`),
      ...(page < pages - 1 ? [h(Button, { key: history ? 'next-history' : 'next-workers', label: 'Next page', onPress: () => {
        state.page(history ? 'previous' : 'active', 1, workers); $.ui.invalidate('ui.render');
      } })] : [])
    )] : [];
    return /** @type {import('claude-code').RenderElement} */ (h(Box, { flexDirection: 'column', gap: 1 },
      h(Text, { bold: true }, `${view.active.length} active agent${view.active.length === 1 ? '' : 's'}`),
      ...renderRows(view.activeRows),
      ...renderPages(false, view.activePages, state.activePage),
      ...(view.previous.length ? [h(Button, { key: 'toggle-previous', plain: true, dimColor: !state.historyOpen,
        label: `${state.historyOpen ? '▾' : '▸'} Previous agents (${view.previous.length})${!state.historyOpen && view.failedCount ? ` · ${view.failedCount} failed` : ''}`, hotkey: 'p',
        onPress: () => { state.toggleHistory(); $.ui.invalidate('ui.render'); }
      }),
        ...(state.historyOpen ? [...renderRows(view.previousRows, true), ...renderPages(true, view.previousPages, state.previousPage)] : [])
      ] : []),
      ...(!workers.length ? [h(Text, { dimColor: true }, 'No Codex workers yet.')] : [])
    ));
  });
  return undefined;
}
