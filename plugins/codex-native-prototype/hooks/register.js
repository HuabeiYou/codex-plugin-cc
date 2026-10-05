// Claude manages the Agent; the shared rescue runtime executes its task.
import { createRun, acceptEvent, readEvents, finalAnswer, displayText } from './protocol.mjs';

const runs = new Map();
const spawnRows = new Map();
const PANE_ID = 'codex-native-activity';
const AGENT_TYPE = 'codex-native-prototype:worker';
let selectedAgentId = null;
let expandedActivity = false;
let paneViewAgentId;
let workerPage = 0;
const WORKERS_PER_PAGE = 5;

/** @returns {import('claude-code').TurnStepResult} */
function stepResult(e, answer) {
  return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null };
}

function activityText(run, event) {
  if (event.kind === 'ready') return `Codex${run.model ? ' (' + run.model + ')' : ''} started · Thread ${run.threadId}`;
  if (event.kind === 'activity') return `${event.threadId && event.threadId !== run.threadId ? '↳ ' + event.threadId + ' · ' : ''}${event.label} [${event.status}]`;
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
  const result = await $.process.run(['node', `${$.plugin.root}/scripts/bridge.mjs`, 'cancel', run.id]);
  if (result.exitCode !== 0) { $.ui.toast('Could not stop Codex: ' + result.stderr); return; }
  if (JSON.parse(result.stdout).requested) {
    run.status = 'stopping';
    $.ui.invalidate('ui.render');
  }
}

/** @returns {import('claude-code').RenderElement} */
function renderActivity($, e, selectedRuns) {
  const { Box, Text, Button } = $.ui.resolve(e);
  return /** @type {import('claude-code').RenderElement} */ (h(Box, { flexDirection: 'column', gap: 1 }, ...selectedRuns.map((run) =>
    h(Box, { key: run.id, flexDirection: 'column' },
      h(Text, { bold: true, wrap: 'truncate-end' }, displayText(`Codex${run.model ? ' (' + run.model + ')' : ''} · ${run.description} · ${run.status}`)),
      h(Text, { dimColor: true, wrap: 'truncate-end' }, displayText(`Agent ${run.agentId} · Thread ${run.threadId || 'starting'}`)),
      ...run.activity.slice(expandedActivity ? -20 : -8).map((activity, i) => {
        const text = displayText(activityText(run, activity));
        return h(Text, { key: `${run.id}-${i}`, dimColor: true, wrap: expandedActivity ? 'wrap' : 'truncate-end' },
          expandedActivity ? text : text.replace(/\s+/g, ' '));
      }),
      ...(run.error && run.status !== 'interrupted' ? [h(Text, { color: 'red' }, displayText(run.error))] : []),
      h(Button, { key: 'expand-activity', label: expandedActivity ? 'Compact activity' : 'Expand activity', onPress: () => {
        expandedActivity = !expandedActivity; $.ui.invalidate('ui.render');
      } }),
      ...(run.status === 'running' || run.status === 'starting' ? [h(Button, {
        key: `stop-${run.id}`, label: 'Stop Codex', onPress: () => stopRun($, run)
      })] : [])
    ))));
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
    try { await $.process.run(['node', `${$.plugin.root}/scripts/native-ready-server.mjs`, '--clear']); }
    catch { /* The host may already be shutting down. Its identity expires. */ }
    return next(e);
  });

  on('agent.spawn', { subagentType: AGENT_TYPE }, async ($, e, next) => {
    const spawned = await next(e);
    if (spawned.agentId) {
      spawnRows.set(spawned.agentId, { toolUseId: e.tool_use_id, prompt: e.prompt, cwd: e.cwd });
      let run = runs.get(spawned.agentId);
      if (!run) { run = createRun(spawned.agentId, e.description || 'Codex task', crypto.randomUUID()); runs.set(spawned.agentId, run); }
      selectedAgentId ??= spawned.agentId;
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
    const bound = await $.process.run(['node', `${$.plugin.root}/scripts/bridge.mjs`, 'bind-output', run.id, outputFile, result.agentId],
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
        await $.process.run(['node', `${$.plugin.root}/scripts/bridge.mjs`, 'cancel', run.id, '--wait']);
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
    let run = runs.get(e.agentId);
    if (run?.started && run.claudeTurnId === e.turnId) {
      // Never rerun a Codex task if Claude's loop unexpectedly requests a retry.
      const answer = workerAnswer(run);
      yield { kind: 'text', index: 0, text: answer };
      yield { kind: 'stop', stopReason: 'end_turn', usage: null };
      return stepResult(e, answer);
    }
    run ??= createRun(e.agentId, agent.description, crypto.randomUUID());
    // Claude's agents view checkpoints a child and resumes it in another host.
    // Keep the bridge identity across that handoff, scoped to this plugin/agent.
    const saved = /** @type {{ id?: string, pluginData?: string, prompt?: string } | undefined} */ (await $.store.get(`native-run:${e.agentId}`));
    if (saved?.id) { run.id = saved.id; run.pluginData = saved.pluginData; }
    run.started = true;
    run.claudeTurnId = e.turnId;
    run.status = 'starting';
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
      let prompt = row?.prompt || saved?.prompt;
      if (!prompt) {
        const messages = await $.session.messages({ agentId: e.agentId });
        if (!Array.isArray(messages)) throw new Error(messages.deny);
        prompt = [...messages].reverse().find((message) => message.role === 'user')?.text;
      }
      if (!prompt) throw new Error('The native agent task could not be read.');
      const sessionId = await $.session.id();
      if (!run.pluginData) {
        const location = await $.process.run(['node', `${$.plugin.root}/scripts/bridge.mjs`, 'report-path', run.id],
          { env: { CODEX_COMPANION_SESSION_ID: sessionId } });
        if (location.exitCode !== 0) throw new Error(`Could not resolve Codex data: ${location.stderr}`);
        run.pluginData = JSON.parse(location.stdout).pluginData;
      }
      // Persist restoration inputs before the task starts, including an early
      // agents-view switch that happens before its first ready event arrives.
      await $.store.set(`native-run:${e.agentId}`, { id: run.id, pluginData: run.pluginData, prompt });
      // Real progress chunks reset Claude's watchdog; UI redraws do not.
      yield { kind: 'thinking', index: 0, text: 'Starting Codex.\n' };
      // Auto-open is optional inspection and must not hold a background task.
      $.ui.open({ id: PANE_ID, title: 'Codex activity' }).catch((error) => {
        run.noticeError = error instanceof Error ? error.message : String(error);
      });
      $.ui.invalidate('ui.render');
      stream = $.process.spawn({
        argv: ['node', `${$.plugin.root}/scripts/bridge.mjs`, 'run', run.id],
        cwd: row?.cwd || await $.session.cwd(),
        env: { CODEX_COMPANION_SESSION_ID: sessionId, ...(run.pluginData ? { CLAUDE_PLUGIN_DATA: run.pluginData } : {}) },
        input: JSON.stringify({ prompt })
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
      run.status = next.signal.aborted ? 'interrupted' : 'failed';
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
    run.status = next.signal.aborted ? 'interrupted' : 'failed';
    run.error = next.error.message;
    if (next.signal.aborted) throw next.error;
    const answer = workerAnswer(run);
    yield { kind: 'text', index: 0, text: answer };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return stepResult(e, answer);
  });

  on('turn.complete', async ($, e, next) => {
    const run = e.agentId ? runs.get(e.agentId) : null;
    if (run && e.isAborted) { run.status = 'interrupted'; $.ui.invalidate('ui.render'); }
    return next(e);
  });

  on('command.run', { command: 'codex-native' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Usage: /codex-native <task>' };
    const spawned = await $.agent.spawn({ subagentType: AGENT_TYPE, prompt: e.args, description: e.args.slice(0, 60) });
    return { text: spawned.deny || `Started Codex agent ${spawned.agentId}. Use /codex-native-status for activity.` };
  });
  on('command.run', { command: 'codex-native-status' }, async ($) => {
    await $.ui.open({ id: PANE_ID, title: 'Codex activity', focus: true });
    return { text: [...runs.values()].map((run) => `${run.agentId}: ${run.description} · ${run.status}`).join('\n') || 'No native Codex agents yet.' };
  });
  on('command.run', { command: 'codex-native-stop' }, async ($, e) => {
    const run = runs.get(e.args.trim());
    if (!run) return { text: 'Supply an agent id from /codex-native-status.' };
    await stopRun($, run);
    return { text: `Codex agent ${run.agentId}: ${run.status}` };
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    const workers = [...runs.values()];
    if (paneViewAgentId !== e.props.view.agentId) {
      paneViewAgentId = e.props.view.agentId;
      if (runs.has(paneViewAgentId)) {
        selectedAgentId = paneViewAgentId;
        workerPage = Math.floor(workers.findIndex((run) => run.agentId === selectedAgentId) / WORKERS_PER_PAGE);
        expandedActivity = false;
      }
    }
    const selected = runs.get(selectedAgentId) || workers[0];
    const pages = Math.max(1, Math.ceil(workers.length / WORKERS_PER_PAGE));
    workerPage = Math.min(workerPage, pages - 1);
    const { Box, Text, Button } = $.ui.resolve(e);
    return /** @type {import('claude-code').RenderElement} */ (h(Box, { flexDirection: 'column', gap: 1 },
      h(Text, { bold: true }, `${workers.length} Codex worker${workers.length === 1 ? '' : 's'}`),
      ...workers.slice(workerPage * WORKERS_PER_PAGE, (workerPage + 1) * WORKERS_PER_PAGE).map((run, i) => h(Button, { key: `select-${run.agentId}`, plain: true,
        label: `${selected === run ? '› ' : '  '}${displayText(run.description, 42).replace(/\s+/g, ' ')} · ${displayText(run.status, 32)}`,
        hotkey: String(i + 1),
        onPress: () => { selectedAgentId = run.agentId; expandedActivity = false; $.ui.invalidate('ui.render'); }
      })),
      ...(pages > 1 ? [h(Box, { flexDirection: 'row', gap: 1 },
        h(Button, { key: 'previous-workers', label: 'Previous workers', onPress: () => { workerPage = (workerPage + pages - 1) % pages; $.ui.invalidate('ui.render'); } }),
        h(Text, {}, `${workerPage + 1}/${pages}`),
        h(Button, { key: 'next-workers', label: 'Next workers', onPress: () => { workerPage = (workerPage + 1) % pages; $.ui.invalidate('ui.render'); } })
      )] : []),
      ...(selected ? [renderActivity($, e, [selected])] : [h(Text, { dimColor: true }, 'No Codex workers yet.')])
    ));
  });
  return undefined;
}
