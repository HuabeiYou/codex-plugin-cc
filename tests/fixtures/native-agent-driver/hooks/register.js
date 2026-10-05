// TEST ONLY. Drives a real foreground Agent call with scripted parent responses.
// The native worker still runs the real Codex harness (or a fake on PATH).
let child = null;
let result = null;
let steps = 0;
const bridgeEvents = [];
let cancelMode = false;
let stopped = null;
export function register(on) {
  on('process.spawn', async function* ($, e, next) {
    if (!e.argv.some((arg) => arg.endsWith('/codex-native-prototype/scripts/bridge.mjs'))) return yield* next(e);
    let buffer = '';
    const stream = next(e);
    while (true) {
      const item = await stream.next();
      if (item.done) return { value: item.value };
      const chunk = item.value;
      if (chunk.stream === 'stdout') {
        const lines = (buffer + chunk.text).split('\n');
        buffer = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.kind !== 'text') bridgeEvents.push(event);
        }
      }
      yield chunk;
    }
  });
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) child = { agentId: e.agentId, answer: e.answer, isAborted: e.isAborted, reason: e.reason, turnId: e.turnId };
    return next(e);
  });
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const response = await next(e);
    result = response;
    return response;
  });
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const response = await next(e);
    stopped = { taskId: e.task_id, isError: response.isError ?? false };
    return response;
  });
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    steps++;
    if (steps === 1) {
      const task = await $.env.get('CODEX_NATIVE_ACCEPTANCE_TASK') || 'Read README.md and describe this repository in one sentence. Do not edit anything.';
      cancelMode = await $.env.get('CODEX_NATIVE_ACCEPTANCE_CANCEL') === '1';
      const input = { subagent_type: 'codex-native-prototype:worker', description: 'Native acceptance', prompt: task, run_in_background: cancelMode };
      yield { kind: 'tool', index: 0, id: 'native_acceptance_agent', name: 'Agent' };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: 'Agent', input }], stopReason: 'tool_use', usage: null };
    }
    if (cancelMode && steps === 2) {
      // Stop an actual started turn, rather than merely canceling startup.
      for (let attempt = 0; attempt < 60 && !bridgeEvents.some((event) => event.type === 'turn'); attempt++) await $.clock.sleep(100);
      await $.clock.sleep(300);
      const input = { task_id: result.result.agentId };
      yield { kind: 'tool', index: 0, id: 'native_acceptance_stop', name: 'TaskStop' };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: 'TaskStop', input }], stopReason: 'tool_use', usage: null };
    }
    if (cancelMode) await $.clock.sleep(250);
    const answer = JSON.stringify({ child, agentId: result?.result?.agentId, stopped, bridgeEvents, scriptedParentSteps: steps });
    yield { kind: 'text', index: 0, text: answer };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null };
  });
}
