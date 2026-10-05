import { test, expect } from 'claude-code/testing';

const TYPE = 'codex-native-prototype:worker';
const STEP = { turnId: 'native-turn', index: 0, model: 'unused', messageCount: 1, agentId: 'native-agent' };
const PANE = { component: 'Pane' as const, requestId: 'codex-native-activity', props: { title: 'Codex activity', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } };

function dependencies(on, agents = [{ id: 'native-agent', type: TYPE, description: 'Read README', status: 'running' }]) {
  on('agent.list', () => ({ value: agents }));
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Read README.md' }] }));
  on('session.id', () => ({ value: 'native-test-session' }));
  on('session.cwd', () => ({ value: '/tmp' }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
}

async function collect(stream) {
  let text = '';
  while (true) {
    const chunk = await stream.next();
    if (chunk.done) return { text, result: chunk.value };
    if (chunk.value.kind === 'text') text += chunk.value.text;
  }
}

test('parent and ordinary Claude subagent requests pass through unchanged', async ($, on) => {
  dependencies(on, [{ id: 'ordinary', type: 'Explore', description: 'Explore', status: 'running' }]);
  let passed = 0;
  on('turn.step', async function* ($, e) {
    passed++;
    yield { kind: 'text', index: 0, text: 'Claude response' };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return { turnId: e.turnId, index: e.index, answer: 'Claude response', toolUses: [], stopReason: 'end_turn', usage: null };
  });
  expect((await collect($.turn.step({ ...STEP, agentId: undefined }))).text).toBe('Claude response');
  expect((await collect($.turn.step({ ...STEP, agentId: 'ordinary' }))).text).toBe('Claude response');
  expect(passed).toBe(2);
});

test('native response streams once, repeated model steps do not repeat execution, and both UI surfaces show activity', async ($, on) => {
  dependencies(on);
  let processes = 0;
  let toolUseId;
  on('agent.spawn', ($, e) => {
    toolUseId = e.tool_use_id;
    return { agentId: 'native-agent', model: 'unused' };
  });
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'Original Agent row');
  });
  on('process.spawn', async function* () {
    processes++;
    const events = [
      { kind: 'ready', threadId: 'codex-thread' },
      { kind: 'activity', threadId: 'codex-thread', label: 'cat README.md', status: 'completed' },
      { kind: 'text', text: 'Streamed ' },
      { kind: 'text', text: 'answer' },
      { kind: 'result', status: 'completed', answer: 'Streamed answer', threadId: 'codex-thread' }
    ];
    const serialized = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    yield { stream: 'stdout', text: serialized.slice(0, 17) };
    yield { stream: 'stdout', text: serialized.slice(17) };
    return { value: { code: 0, signal: null } };
  });
  await $.agent.spawn({ subagentType: TYPE, prompt: 'Read README.md', description: 'Read README', tool_use_id: 'native-tool',
    provider: { plugin: 'codex-native-prototype', tier: 'user' }, parentModel: 'unused', background: false, fork: false });
  expect((await collect($.turn.step(STEP))).text).toBe('Streamed answer');
  expect((await collect($.turn.step({ ...STEP, index: 1 }))).text).toBe('Streamed answer');
  expect(processes).toBe(1);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'codex-native-prototype', surface, ...PANE });
    expect(await ui.find({ type: 'Text', text: 'cat README.md' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'completed' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Stop Codex' })).toBeUndefined();
    await ui.unmount();
    const row = await $.ui.mount({ plugin: 'codex-native-prototype', surface, component: 'ToolUse', requestId: toolUseId,
      props: { tool_use_id: toolUseId, tool: 'Agent', input: { subagent_type: TYPE, description: 'Read README', prompt: 'Read README.md' },
        isRunning: false, isErrored: false, isInterrupted: false } });
    expect(await row.find({ type: 'Text', text: 'Codex' })).toBeDefined();
    expect(await row.find({ type: 'Text', text: 'completed' })).toBeDefined();
    expect(await row.find({ type: 'Text', text: 'Original Agent row' })).toBeDefined();
    await row.unmount();
  }
});

test('a newly spawned worker has its activity row before its execution starts', async ($, on) => {
  dependencies(on);
  on('agent.spawn', () => ({ agentId: 'native-agent', model: 'unused' }));
  on('ui.render', { component: 'ToolUse' }, ($, e) => h($.ui.resolve(e).Text, {}, 'Original Agent row'));
  await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement the fix.', description: 'Implement fix', tool_use_id: 'starting-tool',
    provider: { plugin: 'codex-native-prototype', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
  const row = await $.ui.mount({ plugin: 'codex-native-prototype', surface: 'terminal', component: 'ToolUse', requestId: 'starting-tool',
    props: { tool_use_id: 'starting-tool', tool: 'Agent', input: { subagent_type: TYPE, description: 'Implement fix', prompt: 'Implement the fix.' },
      isRunning: true, isErrored: false, isInterrupted: false } });
  expect(await row.find({ type: 'Text', text: 'Codex' })).toBeDefined();
  expect(await row.find({ type: 'Text', text: 'starting' })).toBeDefined();
  await row.unmount();
});

test('a failed bridge yields a visible error and never falls through to a Claude model', async ($, on) => {
  dependencies(on);
  on('process.spawn', async function* () {
    yield { stream: 'stderr', text: 'provider refused the request' };
    return { value: { code: 1, signal: null } };
  });
  const response = await collect($.turn.step(STEP));
  expect(response.text).toMatch('Codex task failed:');
  expect(response.text).toMatch('provider refused');
});

test('the live Stop button addresses only its run and renders interrupted completion', async ($, on) => {
  dependencies(on);
  let release;
  let entered;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let runId;
  let cancelled;
  on('process.spawn', async function* ($, e) {
    runId = e.argv[3];
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'ready', threadId: 'running-thread' }) + '\n' };
    entered();
    await gate;
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: 'interrupted', answer: '' }) + '\n' };
    return { value: { code: 130, signal: null } };
  });
  on('process.run', ($, e) => {
    cancelled = e.argv;
    return { value: { exitCode: 0, stdout: '{"requested":true}', stderr: '' } };
  });
  const pending = collect($.turn.step(STEP));
  await ready;
  const ui = await $.ui.mount({ plugin: 'codex-native-prototype', surface: 'terminal', ...PANE });
  expect(await ui.find({ type: 'Button', text: 'Stop Codex' })).toBeDefined();
  await ui.press({ key: `stop-${runId}` });
  expect(cancelled[2]).toBe('cancel');
  expect(cancelled[3]).toBe(runId);
  release();
  expect((await pending).text).toBe('Codex task interrupted.');
  await ui.unmount();
});


test('background Agent handles point to the saved Codex report, preserving launch feedback', async ($, on) => {
  dependencies(on);
  on('agent.spawn', () => ({ agentId: 'native-agent', model: 'unused' }));
  on('process.run', ($, e) => {
    expect(e.argv[2]).toBe('bind-output');
    expect(e.argv[4]).toBe('/tmp/tasks/native-agent.output');
    expect(e.argv[5]).toBe('native-agent');
    return { value: { exitCode: 0, stdout: '{"bound":true}', stderr: '' } };
  });
  on('tool.call', { tool: 'Agent' }, () => ({ result: { isAsync: true, agentId: 'native-agent', outputFile: '/tmp/tasks/native-agent.output', description: 'Implement fix' } }));
  await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement the fix.', description: 'Implement fix', tool_use_id: 'report-tool',
    provider: { plugin: 'codex-native-prototype', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
  const launched = await $.tool.call({ tool: 'Agent', tool_use_id: 'report-tool', subagent_type: TYPE, prompt: 'Implement the fix.', description: 'Implement fix' });
  expect(launched.result.outputFile).toBe('/tmp/tasks/native-agent.output');
  expect(launched.result.agentId).toBe('native-agent');
  expect(launched.result.description).toBe('Implement fix');

});
