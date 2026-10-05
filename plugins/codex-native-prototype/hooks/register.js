// Claude manages the Agent; the shared rescue runtime executes its task.
import { createRun, acceptEvent, readEvents, finalAnswer } from './protocol.mjs';

const runs = new Map();
const spawnRows = new Map();
const PANE_ID = 'codex-native-activity';
const AGENT_TYPE = 'codex-native-prototype:worker';

/** @returns {import('claude-code').TurnStepResult} */
function stepResult(e, answer) {
  return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null };
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
function renderActivity($, e, selectedRuns, detailed) {
  const { Box, Text, Button } = $.ui.resolve(e);
  return /** @type {import('claude-code').RenderElement} */ (h(Box, { flexDirection: 'column', gap: 1 }, ...selectedRuns.map((run) =>
    h(Box, { key: run.id, flexDirection: 'column' },
      h(Text, { bold: true }, `Codex${run.model ? ' (' + run.model + ')' : ''} · ${run.description} · ${run.status}`),
      ...(detailed ? [h(Text, { dimColor: true }, `Agent ${run.agentId} · Thread ${run.threadId || 'starting'}`)] : []),
      ...run.activity.slice(detailed ? -20 : -1).map((activity, i) => h(Text, { key: `${run.id}-${i}`, dimColor: true },
        `${activity.threadId && activity.threadId !== run.threadId ? '↳ ' + activity.threadId + ' · ' : ''}${activity.label} [${activity.status}]`)),
      ...(run.error ? [h(Text, { color: 'red' }, run.error)] : []),
      ...(run.status === 'running' || run.status === 'starting' ? [h(Button, {
        key: `stop-${run.id}`, label: 'Stop Codex', onPress: () => stopRun($, run)
      })] : [])
    ))));
}

/** @type {import('claude-code').Register} */
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'worker',
      description: 'Delegate substantial implementation, debugging, investigation, or continuation to Codex with live activity. Uses the rescue runtime with file edits and persistent threads. Before delegating, apply codex-native-prototype:codex-native-supervision for task controls and parent ownership through completion.',
      prompt: 'Carry out the delegated task. The Codex Mod runs the shared rescue runtime and supplies your response.',
      tools: [],
      maxTurns: 1
    });
    await $.command.register({ name: 'codex-native', description: 'Delegate a task to the native Codex worker', argumentHint: '<task>', immediate: true });
    await $.command.register({ name: 'codex-native-status', description: 'Show native Codex agents and open their activity', immediate: true });
    await $.command.register({ name: 'codex-native-stop', description: 'Stop a native Codex agent', argumentHint: '<agent-id>', immediate: true });
    return next(e);
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
    const bound = await $.process.run(['node', `${$.plugin.root}/scripts/bridge.mjs`, 'bind-output', run.id, outputFile, result.agentId]);
    if (bound.exitCode !== 0) throw new Error(`Could not bind Codex report: ${bound.stderr}`);
    return response;
  });

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) return yield* next(e);
    const agents = await $.agent.list();
    const agent = agents.find((candidate) => candidate.id === e.agentId && candidate.type === AGENT_TYPE);
    if (!agent) return yield* next(e);
    let run = runs.get(e.agentId);
    if (run?.started) {
      // Never rerun a Codex task if Claude's loop unexpectedly requests a retry.
      const answer = finalAnswer(run);
      yield { kind: 'text', index: 0, text: answer };
      yield { kind: 'stop', stopReason: 'end_turn', usage: null };
      return stepResult(e, answer);
    }
    run ??= createRun(e.agentId, agent.description, crypto.randomUUID());
    run.started = true;
    runs.set(e.agentId, run);
    const row = spawnRows.get(e.agentId);
    run.toolUseId = row?.toolUseId ?? null;
    let streamed = '';
    let buffer = '';
    let stderr = '';
    let stream;
    try {
      const messages = await $.session.messages({ agentId: e.agentId });
      if (!Array.isArray(messages)) throw new Error(messages.deny);
      const prompt = row?.prompt || [...messages].reverse().find((message) => message.role === 'user')?.text;
      if (!prompt) throw new Error('The native agent task could not be read.');
      await $.ui.open({ id: PANE_ID, title: 'Codex activity' });
      $.ui.invalidate('ui.render');
      stream = $.process.spawn({
        argv: ['node', `${$.plugin.root}/scripts/bridge.mjs`, 'run', run.id],
        cwd: row?.cwd || await $.session.cwd(),
        env: { CODEX_COMPANION_SESSION_ID: await $.session.id() },
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
          $.ui.invalidate('ui.render');
          if (event.kind === 'text') {
            streamed += event.text;
            yield { kind: 'text', index: 0, text: event.text };
          }
        }
      }
      if (buffer.trim()) for (const event of readEvents(buffer, '', true).events) acceptEvent(run, event);
      if (next.signal.aborted) run.status = 'interrupted';
    } catch (error) {
      run.status = next.signal.aborted ? 'interrupted' : 'failed';
      run.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (stream) await stream.return({ code: null, signal: 'SIGTERM' });
      $.ui.invalidate('ui.render');
    }
    const answer = finalAnswer(run);
    if (!streamed) yield { kind: 'text', index: 0, text: answer };
    else if (answer !== streamed) yield { kind: 'text', index: 0, text: '\n\n' + answer };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return stepResult(e, answer);
  }).catch(async function* ($, e, next) {
    // A Mods budget/error must never silently send a native Codex task to Claude.
    const run = e.agentId ? runs.get(e.agentId) : null;
    if (!run) return yield* next(e);
    run.status = next.signal.aborted ? 'interrupted' : 'failed';
    run.error = next.error.message;
    const answer = finalAnswer(run);
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
    return renderActivity($, e, [...runs.values()].slice(-8), true);
  });
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const run = [...runs.values()].find((candidate) => candidate.toolUseId === e.requestId);
    if (!run) return next(e);
    const { Box } = $.ui.resolve(e);
    return /** @type {import('claude-code').RenderElement} */ (h(Box, { flexDirection: 'column' }, await next(e), renderActivity($, e, [run], false)));
  });
  return undefined;
}
