// Test-only: every parent turn is scripted; the worker is supplied by Codex.
let feedback;
async function log($, type, data) {
  await $.process.run(['node', `${$.plugin.root}/hooks/log.cjs`, JSON.stringify({ type, ...data })]);
}
function result(e, answer, toolUses = []) {
  return { turnId: e.turnId, index: e.index, answer, toolUses, stopReason: toolUses.length ? 'tool_use' : 'end_turn', usage: null };
}
export function register(on) {
  on('session.start', async ($, e, next) => { await log($, 'session.start', { sessionId: await $.session.id() }); return next(e); });
  on('turn.complete', async ($, e, next) => {
    await log($, 'turn.complete', { agentId: e.agentId, isAborted: e.isAborted, reason: e.reason, answer: e.agentId ? e.answer : null, sessionId: await $.session.id() });
    return next(e);
  });
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const response = await next(e);
    await log($, 'launch', { agentId: response.result?.agentId, outputFile: response.result?.outputFile });
    return response;
  });
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const response = await next(e);
    feedback = JSON.stringify(response.result);
    await log($, 'parent.read', { isError: response.isError, feedback, sessionId: await $.session.id() });
    return response;
  });
  on('process.run', async ($, e, next) => {
    const response = await next(e);
    if (e.argv.some((arg) => arg.endsWith('/native-ready-server.mjs')) && e.argv[2] === '--mark') await log($, 'mod.ready', { response });
    if (e.argv.some((arg) => arg.endsWith('/bridge.mjs') || arg.endsWith('/native-bridge.mjs'))) await log($, 'bridge.control', { command: e.argv[2], response });
    return response;
  });
  on('process.spawn', async function* ($, e, next) {
    if (e.argv[2] !== 'run' || !e.argv.some((arg) => arg.endsWith('/bridge.mjs') || arg.endsWith('/native-bridge.mjs'))) return yield* next(e);
    const stream = next(e);
    while (true) {
      const chunk = await stream.next();
      if (chunk.done) return chunk.value;
      if (chunk.value.stream === 'stdout') {
        await log($, 'bridge.chunk', { text: chunk.value.text });
        if (chunk.value.text.includes('"kind":"ready"')) await log($, 'restore.ownership', {});
      }
      yield chunk.value;
    }
  });
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      if (!next.signal.aborted) await log($, 'missed.worker', { agentId: e.agentId });
      const answer = 'TEST FAILURE: the native Mod did not restore the worker.';
      yield { kind: 'text', index: 0, text: answer };
      yield { kind: 'stop', stopReason: 'end_turn', usage: null };
      return result(e, answer);
    }
    await log($, 'parent.step', { sessionId: await $.session.id(), agents: await $.agent.list() });
    const check = JSON.parse((await $.process.run(['node', `${$.plugin.root}/hooks/log.cjs`, 'claim'])).stdout);
    const tool = check.launch ? 'Agent' : check.completed && !feedback ? 'Read' : null;
    const input = tool === 'Agent' ? { subagent_type: JSON.parse((await $.process.run(['node', `${$.plugin.root}/hooks/log.cjs`, 'config'])).stdout).agentType, description: 'Navigation acceptance', prompt: 'Implement the simulated navigation task.', run_in_background: true }
      : { file_path: check.outputFile };
    if (tool) {
      yield { kind: 'tool', index: 0, id: `navigation_${tool}`, name: tool };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return result(e, '', [{ name: tool, input }]);
    }
    const answer = feedback ? 'Read the completed Codex report.' : 'Waiting for the Codex worker.';
    yield { kind: 'text', index: 0, text: answer };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return result(e, answer);
  });
}
