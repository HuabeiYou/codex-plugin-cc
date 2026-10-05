import { test, expect } from 'claude-code/testing';

const TYPE = 'codex-native-prototype:worker';
const STEP = { turnId: 'native-turn', index: 0, model: 'unused', messageCount: 1, agentId: 'native-agent' };
const PANE = { component: 'Pane' as const, requestId: 'codex-native-activity', props: { title: 'Codex activity', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } };

function dependencies(on, agents = [{ id: 'native-agent', type: TYPE, description: 'Read README', status: 'running' }], onOpen = () => {}) {
  on('agent.list', () => ({ value: agents }));
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Read README.md' }] }));
  on('session.id', () => ({ value: 'native-test-session' }));
  on('session.cwd', () => ({ value: '/tmp' }));
  on('ui.open', () => { onOpen(); return { value: { isPlaced: true } }; });
}

async function collect(stream) {
  let text = '';
  const progress = [];
  while (true) {
    const chunk = await stream.next();
    if (chunk.done) return { text, result: chunk.value, progress };
    if (chunk.value.kind === 'text') text += chunk.value.text;
    if (chunk.value.kind === 'thinking') progress.push(chunk.value.text);
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

test('parent rows stay native, the pane opens automatically, and display failures do not rerun the task', async ($, on) => {
  let processes = 0;
  let toolUseId;
  let opened = 0;
  dependencies(on, undefined, () => { opened++; });
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
  const response = await collect($.turn.step(STEP));
  expect(response.text.startsWith('Streamed answer')).toBe(true);
  expect(response.progress.some((text) => text.includes('cat README.md'))).toBe(true);
  // This test engine has no transcript store; real-host acceptance checks storage and ownership.
  expect(response.text).toMatch('Codex activity display was unavailable:');
  expect(response.text.split('Streamed answer').length).toBe(2);
  expect((await collect($.turn.step({ ...STEP, index: 1 }))).text).toBe(response.text);
  expect(processes).toBe(1);
  expect(opened).toBe(1);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'codex-native-prototype', surface, ...PANE });
    expect(await ui.find({ type: 'Text', text: 'cat README.md' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'completed' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Stop Codex' })).toBeUndefined();
    await ui.unmount();
    const row = await $.ui.mount({ plugin: 'codex-native-prototype', surface, component: 'ToolUse', requestId: toolUseId,
      props: { tool_use_id: toolUseId, tool: 'Agent', input: { subagent_type: TYPE, description: 'Read README', prompt: 'Read README.md' },
        isRunning: false, isErrored: false, isInterrupted: false } });
    expect(await row.find({ type: 'Text', text: 'Codex' })).toBeUndefined();
    expect(await row.find({ type: 'Text', text: 'cat README.md' })).toBeUndefined();
    expect(await row.find({ type: 'Text', text: 'Original Agent row' })).toBeDefined();
    await row.unmount();
  }
  await $.command.run({ command: 'codex-native-status', args: '' });
  expect(opened).toBe(2);
});

test('launch leaves the parent Agent row unchanged', async ($, on) => {
  dependencies(on);
  on('agent.spawn', () => ({ agentId: 'native-agent', model: 'unused' }));
  on('ui.render', { component: 'ToolUse' }, ($, e) => h($.ui.resolve(e).Text, {}, 'Original Agent row'));
  await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement the fix.', description: 'Implement fix', tool_use_id: 'starting-tool',
    provider: { plugin: 'codex-native-prototype', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
  const row = await $.ui.mount({ plugin: 'codex-native-prototype', surface: 'terminal', component: 'ToolUse', requestId: 'starting-tool',
    props: { tool_use_id: 'starting-tool', tool: 'Agent', input: { subagent_type: TYPE, description: 'Implement fix', prompt: 'Implement the fix.' },
      isRunning: true, isErrored: false, isInterrupted: false } });
  expect(await row.find({ type: 'Text', text: 'Codex' })).toBeUndefined();
  expect(await row.find({ type: 'Text', text: 'Original Agent row' })).toBeDefined();
  await row.unmount();
});

test('multiple workers share a compact selector and show only the selected worker details', async ($, on) => {
  const agents = ['one', 'two'].map((id) => ({ id, type: TYPE, description: `Worker ${id}`, status: 'running' }));
  dependencies(on, agents);
  on('agent.spawn', ($, e) => ({ agentId: e.description === 'Worker one' ? 'one' : 'two', model: 'unused' }));
  let execution = 0;
  on('process.spawn', async function* () {
    const id = ++execution === 1 ? 'one' : 'two';
    const events = [
      { kind: 'ready', threadId: `thread-${id}` },
      { kind: 'activity', threadId: `thread-${id}`, label: `command-${id}`, status: 'completed' },
      { kind: 'result', status: 'completed', answer: `answer-${id}` }
    ];
    yield { stream: 'stdout', text: events.map((e) => JSON.stringify(e)).join('\n') + '\n' };
    return { value: { code: 0, signal: null } };
  });
  for (const id of ['one', 'two']) {
    await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement fix', description: `Worker ${id}`, tool_use_id: `tool-${id}`,
      provider: { plugin: 'codex-native-prototype', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
    await collect($.turn.step({ ...STEP, agentId: id, turnId: `turn-${id}` }));
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'codex-native-prototype', surface, ...PANE });
    expect(await ui.find({ type: 'Button', text: 'Worker one' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Worker two' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'command-one' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'command-two' })).toBeUndefined();
    await ui.press({ key: 'select-two' });
    expect(await ui.find({ type: 'Text', text: 'command-one' })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: 'command-two' })).toBeDefined();
    await ui.press({ key: 'select-one' });
    await ui.unmount();
    const workerView = await $.ui.mount({ plugin: 'codex-native-prototype', surface, ...PANE,
      props: { ...PANE.props, view: { agentId: 'two' } } });
    expect(await workerView.find({ type: 'Text', text: 'command-two' })).toBeDefined();
    expect(await workerView.find({ type: 'Text', text: 'command-one' })).toBeUndefined();
    await workerView.press({ key: 'select-one' });
    expect(await workerView.find({ type: 'Text', text: 'command-one' })).toBeDefined();
    expect(await workerView.find({ type: 'Text', text: 'command-two' })).toBeUndefined();
    await workerView.unmount();
  }
});

test('worker history is paged so it cannot fill the activity pane', async ($, on) => {
  dependencies(on);
  on('agent.spawn', ($, e) => ({ agentId: e.description, model: 'unused' }));
  for (let i = 1; i <= 6; i++) {
    await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement fix', description: `Worker ${i}`, tool_use_id: `tool-${i}`,
      provider: { plugin: 'codex-native-prototype', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
  }
  const ui = await $.ui.mount({ plugin: 'codex-native-prototype', surface: 'terminal', ...PANE });
  expect(await ui.find({ type: 'Button', text: 'Worker 1' })).toBeDefined();
  expect(await ui.find({ type: 'Button', text: 'Worker 5' })).toBeDefined();
  expect(await ui.find({ type: 'Button', text: 'Worker 6' })).toBeUndefined();
  await ui.press({ key: 'next-workers' });
  expect(await ui.find({ type: 'Button', text: 'Worker 1' })).toBeUndefined();
  expect(await ui.find({ type: 'Button', text: 'Worker 6' })).toBeDefined();
  await ui.press({ key: 'select-Worker 6' });
  expect(await ui.find({ type: 'Text', text: 'Agent Worker 6' })).toBeDefined();
  await ui.unmount();
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
  expect((await pending).text).toMatch('Codex task interrupted.');
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
