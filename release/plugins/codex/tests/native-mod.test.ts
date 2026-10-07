import { test, expect, mock } from 'claude-code/testing';

const TYPE = 'codex:worker';
const STEP = { turnId: 'native-turn', index: 0, model: 'unused', messageCount: 1, agentId: 'native-agent' };
const PANE = { component: 'Pane' as const, requestId: 'codex-native-activity', props: { title: 'Codex activity', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } };

function dependencies(on, agents = [{ id: 'native-agent', type: TYPE, description: 'Read README', status: 'running' }], onOpen = () => {}, onProcessRun = null,
  messages = () => [{ role: 'user', text: 'Read README.md' }]) {
  mock.store(on);
  on('process.run', async ($, e, next) => {
    if (e.argv[2] === 'report-path') return { value: { exitCode: 0, stdout: JSON.stringify({ pluginData: '/tmp/native-mod-test-data' }), stderr: '' } };
    return onProcessRun ? onProcessRun($, e) : next(e);
  });
  on('agent.list', () => ({ value: agents }));
  on('session.messages', () => ({ value: messages() }));
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

test('feedback resumes one pane entry with fresh input while retries keep the request identity', async ($, on) => {
  dependencies(on);
  on('session.receive', ($, e) => ({ text: e.text }));
  on('session.append', () => ({ stored: true }));
  const requests = [];
  let release;
  let entered;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  on('process.spawn', async function* ($, e) {
    requests.push({ ...JSON.parse(e.input), runId: e.argv[3] });
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'ready', threadId: 'same-topic' }) + '\n' };
    if (requests.length === 2) { entered(); await gate; }
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: 'completed', threadId: 'same-topic', answer: 'Round ' + requests.length }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  await collect($.turn.step(STEP));
  await $.session.receive({ agentId: 'native-agent', origin: { kind: 'plugin', plugin: 'test' }, text: 'Re-review after fixing your findings.' });
  const pending = collect($.turn.step({ ...STEP, turnId: 'feedback-turn' }));
  await ready;
  const ui = await $.ui.mount({ plugin: 'codex', surface: 'terminal', ...PANE });
  try {
    expect(await ui.find({ type: 'Text', text: '1 active agent' })).toBeDefined();
    expect(await ui.find({ key: 'toggle-previous' })).toBeUndefined();
    expect(requests[1].runId).toBe(requests[0].runId);
    expect(requests[1].requestId).not.toBe(requests[0].requestId);
    expect(requests[1].prompt).toBe('Re-review after fixing your findings.');
    release();
    const second = (await pending).text;
    expect(second.startsWith('Round 2')).toBe(true);
    expect((await collect($.turn.step({ ...STEP, turnId: 'feedback-turn', index: 1 }))).text).toBe(second);
    expect(requests).toHaveLength(2);
    expect((await ui.find({ key: 'toggle-previous' }))?.text).toBe('▸ Previous agents (1)');
  } finally { release(); await pending; await ui.unmount(); }
});

test('session end sends owned workers for archival and host handoff skips cleanup', async ($, on) => {
  const controls = [];
  dependencies(on, undefined, undefined, ($, e) => {
    controls.push(e.argv);
    return { value: { exitCode: 0, stdout: '{}', stderr: '' } };
  });
  on('session.append', () => ({ stored: true }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: 'completed', answer: 'Done' }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  await collect($.turn.step(STEP));
  const ending = { sessionId: 'native-test-session', resume: { id: 'native-test-session' }, reason: 'resume' as const };
  await $.session.end(ending);
  expect(controls.filter((argv) => argv[2] === 'archive')).toHaveLength(0);
  await $.session.end({ ...ending, reason: 'other' });
  const archives = controls.filter((argv) => argv[2] === 'archive');
  expect(archives).toHaveLength(1);
  expect(JSON.parse(archives[0][3]).runIds).toHaveLength(1);
  expect(JSON.parse(archives[0][3]).sessionId).toBe('native-test-session');
});

test('new transcript input resumes a completed worker even when Claude retains its turn ID', async ($, on) => {
  let messages = [{ role: 'user' as const, text: 'Implement the topic.' }];
  dependencies(on, undefined, undefined, undefined, () => messages);
  const requests = [];
  on('process.spawn', async function* ($, e) {
    requests.push({ ...JSON.parse(e.input), runId: e.argv[3] });
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: 'completed', answer: 'Round ' + requests.length }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  expect((await collect($.turn.step(STEP))).text).toBe('Round 1');
  messages = [...messages, { role: 'user', text: 'Adjust the original implementation.' }];
  expect((await collect($.turn.step(STEP))).text).toBe('Round 2');
  expect(requests[1].prompt).toBe('Adjust the original implementation.');
  expect(requests[1].runId).toBe(requests[0].runId);
  expect(requests[1].requestId).not.toBe(requests[0].requestId);
  expect((await collect($.turn.step({ ...STEP, index: 1 }))).text).toBe('Round 2');
  expect(requests).toHaveLength(2);
});

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
  on('process.spawn', async function* ($) {
    processes++;
    const events = [
      { kind: 'ready', threadId: 'codex-thread' },
      { kind: 'activity', threadId: 'codex-thread', label: 'cat README.md', status: 'completed' },
      { kind: 'activity', threadId: 'opaque-child-thread', label: 'Inspect child output', status: 'completed' },
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
    provider: { plugin: 'codex', tier: 'user' }, parentModel: 'unused', background: false, fork: false });
  const response = await collect($.turn.step(STEP));
  expect(response.text.startsWith('Streamed answer')).toBe(true);
  expect(response.progress.some((text) => text.includes('cat README.md'))).toBe(true);
  expect(response.progress.join('')).not.toMatch('codex-thread');
  expect(response.progress.join('')).not.toMatch('opaque-child-thread');
  // This test engine has no transcript store; real-host acceptance checks storage and ownership.
  expect(response.text).toMatch('Codex activity display was unavailable:');
  expect(response.text.split('Streamed answer').length).toBe(2);
  expect((await collect($.turn.step({ ...STEP, index: 1 }))).text).toBe(response.text);
  expect(processes).toBe(1);
  expect(opened).toBe(1);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'codex', surface, ...PANE });
    expect(await ui.find({ type: 'Text', text: 'cat README.md' })).toBeUndefined();
    await ui.press({ key: 'toggle-previous' });
    expect(await ui.find({ type: 'Text', text: 'cat README.md' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'completed' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Stop Codex' })).toBeUndefined();
    await ui.press({ key: 'toggle-previous' });
    await ui.unmount();
    const row = await $.ui.mount({ plugin: 'codex', surface, component: 'ToolUse', requestId: toolUseId,
      props: { tool_use_id: toolUseId, tool: 'Agent', input: { subagent_type: TYPE, description: 'Read README', prompt: 'Read README.md' },
        isRunning: false, isErrored: false, isInterrupted: false } });
    expect(await row.find({ type: 'Text', text: 'Codex' })).toBeUndefined();
    expect(await row.find({ type: 'Text', text: 'cat README.md' })).toBeUndefined();
    expect(await row.find({ type: 'Text', text: 'Original Agent row' })).toBeDefined();
    await row.unmount();
  }
  expect((await $.command.run({ command: 'codex-native-status', args: '' })).text).toBe('Opened Codex activity.');
  expect(opened).toBe(2);
});

test('status and launch replies keep opaque IDs and duplicate worker lists out of the transcript', async ($, on) => {
  let opened = 0;
  dependencies(on, undefined, () => { opened++; });
  on('agent.spawn', () => ({ agentId: 'adfe0f7f1210bc730', model: 'unused' }));
  expect((await $.command.run({ command: 'codex-native-status', args: '' })).text).toBe('Opened Codex activity.');
  expect((await $.command.run({ command: 'codex-native', args: 'Polish cache handling' })).text).toBe('Started Codex. Use /codex-native-status for activity.');
  expect((await $.command.run({ command: 'codex-native-status', args: '' })).text).toBe('Opened Codex activity.');
  expect(opened).toBe(2);
  expect((await $.command.run({ command: 'codex-native-stop', args: '' })).text).toMatch('Use Stop Codex in the activity pane');
});

test('launch leaves the parent Agent row unchanged', async ($, on) => {
  dependencies(on);
  on('agent.spawn', () => ({ agentId: 'native-agent', model: 'unused' }));
  on('ui.render', { component: 'ToolUse' }, ($, e) => h($.ui.resolve(e).Text, {}, 'Original Agent row'));
  await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement the fix.', description: 'Implement fix', tool_use_id: 'starting-tool',
    provider: { plugin: 'codex', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
  const row = await $.ui.mount({ plugin: 'codex', surface: 'terminal', component: 'ToolUse', requestId: 'starting-tool',
    props: { tool_use_id: 'starting-tool', tool: 'Agent', input: { subagent_type: TYPE, description: 'Implement fix', prompt: 'Implement the fix.' },
      isRunning: true, isErrored: false, isInterrupted: false } });
  expect(await row.find({ type: 'Text', text: 'Codex' })).toBeUndefined();
  expect(await row.find({ type: 'Text', text: 'Original Agent row' })).toBeDefined();
  await row.unmount();
});

test('expanded activity stays rendered with terminal control characters during live updates', async ($, on) => {
  dependencies(on);
  let advance;
  let entered;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { advance = resolve; });
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'ready', threadId: 'controls-thread' }) + '\n' };
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'activity', label: 'Downloading 10%\rDownloading 20%', status: 'running' }) + '\n' };
    entered();
    await gate;
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'activity', label: '\u001b[32mBuild complete\u001b[0m\u0008', status: 'completed' }) + '\n' };
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: 'completed', answer: 'Done' }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  const pending = collect($.turn.step(STEP));
  await ready;
  const ui = await $.ui.mount({ plugin: 'codex', surface: 'terminal', ...PANE });
  const desktop = await $.ui.mount({ plugin: 'codex', surface: 'desktop', ...PANE });
  try {
    expect(await ui.find({ type: 'Text', text: 'controls-thread' })).toBeUndefined();
    await ui.press({ key: 'expand-activity' });
    expect(await ui.find({ type: 'Text', text: 'controls-thread' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'Downloading 20%' })).toBeDefined();
    advance();
    await pending;
    expect(await ui.find({ type: 'Text', text: 'Build complete' })).toBeUndefined();
    await ui.press({ key: 'toggle-previous' });
    expect(await ui.find({ type: 'Text', text: 'Build complete' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Compact activity' })).toBeDefined();
    expect(await desktop.find({ type: 'Text', text: 'Build complete' })).toBeDefined();
    expect(await desktop.find({ type: 'Button', text: 'Compact activity' })).toBeDefined();
    await ui.press({ key: 'expand-activity' });
    expect(await ui.find({ type: 'Text', text: 'controls-thread' })).toBeUndefined();
  } finally { advance(); await pending; await ui.unmount(); await desktop.unmount(); }
});

test('completed workers are folded by default and opening a worker reveals its own activity', async ($, on) => {
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
      provider: { plugin: 'codex', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
    await collect($.turn.step({ ...STEP, agentId: id, turnId: `turn-${id}` }));
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'codex', surface, ...PANE });
    expect(await ui.find({ type: 'Button', text: 'Worker one' })).toBeUndefined();
    await ui.press({ key: 'toggle-previous' });
    expect(await ui.find({ type: 'Button', text: 'Worker one' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Worker two' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'command-two' })).toBeDefined();
    await ui.press({ key: 'select-one' });
    expect(await ui.find({ type: 'Text', text: 'command-one' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'command-two' })).toBeUndefined();
    await ui.press({ key: 'select-two' });
    expect(await ui.find({ type: 'Text', text: 'command-one' })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: 'command-two' })).toBeDefined();
    await ui.press({ key: 'select-one' });
    await ui.press({ key: 'toggle-previous' });
    await ui.unmount();
    const workerView = await $.ui.mount({ plugin: 'codex', surface, ...PANE,
      props: { ...PANE.props, view: { agentId: 'two' } } });
    expect(await workerView.find({ type: 'Text', text: 'command-two' })).toBeDefined();
    expect(await workerView.find({ type: 'Text', text: 'command-one' })).toBeUndefined();
    await workerView.press({ key: 'select-one' });
    expect(await workerView.find({ type: 'Text', text: 'command-one' })).toBeDefined();
    expect(await workerView.find({ type: 'Text', text: 'command-two' })).toBeUndefined();
    await workerView.press({ key: 'select-two' });
    await workerView.unmount();
  }
});

test('previous agents have separate pagination and stay folded until opened', async ($, on) => {
  const agents = Array.from({ length: 6 }, (_, i) => ({ id: `Worker ${i + 1}`, type: TYPE, description: `Worker ${i + 1}`, status: 'running' }));
  dependencies(on, agents);
  on('agent.spawn', ($, e) => ({ agentId: e.description, model: 'unused' }));
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: 'completed', answer: 'Done' }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  for (const agent of agents) {
    await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement fix', description: agent.id, tool_use_id: `tool-${agent.id}`,
      provider: { plugin: 'codex', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
    await collect($.turn.step({ ...STEP, agentId: agent.id, turnId: `turn-${agent.id}` }));
  }
  const ui = await $.ui.mount({ plugin: 'codex', surface: 'terminal', ...PANE });
  expect(await ui.find({ type: 'Button', text: 'Worker 1' })).toBeUndefined();
  await ui.press({ key: 'toggle-previous' });
  expect(await ui.find({ type: 'Button', text: 'Worker 1' })).toBeUndefined();
  expect(await ui.find({ type: 'Button', text: 'Worker 5' })).toBeDefined();
  expect(await ui.find({ type: 'Button', text: 'Worker 6' })).toBeDefined();
  await ui.press({ key: 'next-history' });
  expect(await ui.find({ type: 'Button', text: 'Worker 1' })).toBeDefined();
  expect(await ui.find({ type: 'Button', text: 'Worker 6' })).toBeUndefined();
  await ui.press({ key: 'select-Worker 1' });
  expect((await ui.find({ key: 'select-Worker 1' }))?.text.startsWith('› ')).toBe(true);
  await ui.press({ key: 'toggle-previous' });
  expect(await ui.find({ type: 'Text', text: 'Agent Worker 6' })).toBeUndefined();
  await ui.unmount();
});

test('active-agent pagination keeps selection and activity attached on each page', async ($, on) => {
  dependencies(on);
  on('agent.spawn', ($, e) => ({ agentId: e.description, model: 'unused' }));
  for (let i = 1; i <= 6; i++) {
    await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement fix', description: `Worker ${i}`, tool_use_id: `tool-${i}`,
      provider: { plugin: 'codex', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'codex', surface, ...PANE });
    expect(await ui.find({ key: 'select-Worker 1' })).toBeDefined();
    expect(await ui.find({ key: 'select-Worker 5' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'Worker 5' })).toBeDefined();
    expect(await ui.find({ key: 'select-Worker 6' })).toBeUndefined();
    await ui.press({ key: 'next-workers' });
    expect(await ui.find({ key: 'select-Worker 1' })).toBeUndefined();
    expect(await ui.find({ key: 'select-Worker 6' })).toBeDefined();
    await ui.press({ key: 'select-Worker 6' });
    expect(await ui.find({ type: 'Text', text: 'Worker 6' })).toBeDefined();
    expect((await ui.find({ key: 'select-Worker 6' }))?.text.startsWith('› ')).toBe(true);
    await ui.press({ key: 'previous-workers' });
    await ui.press({ key: 'select-Worker 1' });
    expect(await ui.find({ type: 'Text', text: 'Worker 1' })).toBeDefined();
    await ui.unmount();
  }
});

for (const surface of ['terminal', 'desktop'] as const) test(`active agents lead folded history and move on completion (${surface})`, { timeoutMs: 15000 }, async ($, on) => {
  const ids = ['completed', 'failed', 'interrupted', 'live-one', 'live-two'];
  dependencies(on, ids.map((id) => ({ id, type: TYPE, description: `Task ${id}`, status: 'running' })));
  // This kit has no transcript store; refuse notices immediately in this UI fixture.
  on('session.append', () => ({ deny: 'Test transcript unavailable' }));
  let execution = 0;
  const releases = [];
  const started = [];
  const gates = [0, 1].map((i) => new Promise<void>((resolve) => { releases[i] = resolve; }));
  const ready = [0, 1].map((i) => new Promise<void>((resolve) => { started[i] = resolve; }));
  on('process.spawn', async function* () {
    const index = execution++;
    const id = ids[index];
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'ready', threadId: `thread-${id}`, model: index === 3 ? 'gpt-6.1-sol' : 'gpt-6-astra', effort: index === 3 ? 'high' : null }) + '\n' };
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'activity', label: `command-${id}`, status: 'running' }) + '\n' };
    if (index >= 3) { started[index - 3](); await gates[index - 3]; }
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: index < 3 ? id : 'completed', answer: 'Done', error: id === 'failed' ? 'Provider error' : null }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  for (const id of ids.slice(0, 3)) await collect($.turn.step({ ...STEP, agentId: id, turnId: `turn-${id}` }));
  const first = collect($.turn.step({ ...STEP, agentId: 'live-one', turnId: 'turn-live-one' }));
  await ready[0];
  const second = collect($.turn.step({ ...STEP, agentId: 'live-two', turnId: 'turn-live-two' }));
  await ready[1];
  const ui = await $.ui.mount({ plugin: 'codex', surface, ...PANE });
  try {
    const [heading, one, two, old, commandOne, commandTwo] = await Promise.all([
      ui.find({ type: 'Text', text: '2 active agents' }), ui.find({ key: 'select-live-one' }), ui.find({ key: 'select-live-two' }),
      ui.find({ key: 'select-completed' }), ui.find({ type: 'Text', text: 'command-live-one' }), ui.find({ type: 'Text', text: 'command-live-two' })
    ]);
    expect(heading).toBeDefined();
    expect(one?.text).toBe('› gpt-6.1-sol · high thinking · running');
    expect(two?.text).toBe('  gpt-6-astra · default thinking · running');
    expect(old).toBeUndefined();
    expect(commandOne).toBeDefined();
    expect(commandTwo).toBeUndefined();
    const tree = await ui.drawn();
    const row = tree.children.find((child) => typeof child !== 'string' && child.props?.key === 'worker-live-one');
    expect(JSON.stringify(row)).toMatch('command-live-one');
    expect(JSON.stringify(row).split('gpt-6.1-sol').length).toBe(2);
    await ui.press({ key: 'toggle-previous' });
    const keys = (await ui.findAll({ type: 'Button' })).map((button) => button.key);
    expect(keys.indexOf('select-live-two') < keys.indexOf('toggle-previous')).toBe(true);
    expect(keys.indexOf('toggle-previous') < keys.indexOf('select-completed')).toBe(true);
    expect(keys.includes('select-failed')).toBe(true);
    expect(keys.includes('select-interrupted')).toBe(true);
    await ui.press({ key: 'select-failed' });
    expect(await ui.find({ type: 'Text', text: 'Provider error' })).toBeDefined();
    await ui.press({ key: 'toggle-previous' });
    expect(await ui.find({ type: 'Text', text: 'command-live-one' })).toBeDefined();
    releases[0](); await first;
    const [activeCount, oldLive, currentCommand, history] = await Promise.all([
      ui.find({ type: 'Text', text: '1 active agent' }), ui.find({ key: 'select-live-one' }),
      ui.find({ type: 'Text', text: 'command-live-two' }), ui.find({ key: 'toggle-previous' })
    ]);
    expect(activeCount).toBeDefined();
    expect(oldLive).toBeUndefined();
    expect(currentCommand).toBeDefined();
    expect(history?.text).toBe('▸ Previous agents (4) · 1 failed');
    releases[1](); await second;
    expect(await ui.find({ type: 'Text', text: '0 active agents' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'command-live-two' })).toBeUndefined();
    expect((await ui.find({ key: 'toggle-previous' }))?.text).toBe('▸ Previous agents (5) · 1 failed');
  } finally {
    releases.forEach((release) => release());
    await Promise.all([first, second]);
    await ui.unmount();
  }
});

test('parent and child activity controls stay independent, with compact lifecycle events and narrow headers', { timeoutMs: 15000 }, async ($, on) => {
  dependencies(on);
  on('session.append', () => ({ deny: 'Test transcript unavailable' }));
  let release;
  let entered;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  on('process.spawn', async function* () {
    const events = [
      { kind: 'ready', threadId: 'polish-thread', model: 'gpt-6.1-sol', effort: 'high' },
      { kind: 'activity', threadId: 'polish-thread', turnId: 'turn', itemId: 'check', type: 'commandExecution', label: 'npm test', status: 'running' },
      { kind: 'activity', threadId: 'polish-thread', turnId: 'turn', itemId: 'check', type: 'commandExecution', label: 'npm test', status: 'completed' }
    ];
    yield { stream: 'stdout', text: events.map((event) => JSON.stringify(event)).join('\n') + '\n' };
    entered(); await gate;
    yield { stream: 'stdout', text: JSON.stringify({ kind: 'result', status: 'completed', answer: 'Done' }) + '\n' };
    return { value: { code: 0, signal: null } };
  });
  const pending = collect($.turn.step(STEP));
  await ready;
  const parent = await $.ui.mount({ plugin: 'codex', surface: 'terminal', ...PANE,
    props: { ...PANE.props, bodyColumns: 44 } });
  const child = await $.ui.mount({ plugin: 'codex', surface: 'desktop', ...PANE,
    props: { ...PANE.props, view: { agentId: 'native-agent' } } });
  try {
    expect((await parent.find({ key: 'select-native-agent' }))?.text).toBe('› gpt-6.1-sol · high · running');
    expect(await parent.findAll({ type: 'Text', text: 'npm test' })).toHaveLength(1);
    expect(await parent.find({ type: 'Text', text: 'polish-thread' })).toBeUndefined();
    const actions = await parent.find({ key: 'actions-native-agent' });
    expect(actions?.props.flexDirection).toBe('row');
    expect(actions?.props.flexWrap).toBe('wrap');
    await child.press({ key: 'expand-activity' });
    expect(await child.findAll({ type: 'Text', text: 'npm test' })).toHaveLength(2);
    expect(await child.find({ type: 'Text', text: 'polish-thread' })).toBeDefined();
    expect(await parent.findAll({ type: 'Text', text: 'npm test' })).toHaveLength(1);
    release(); await pending;
    expect(await parent.find({ type: 'Text', text: 'npm test' })).toBeUndefined();
    expect((await parent.find({ key: 'toggle-previous' }))?.text).toBe('▸ Previous agents (1)');
    expect(await child.findAll({ type: 'Text', text: 'npm test' })).toHaveLength(2);
    expect((await child.find({ key: 'toggle-previous' }))?.text).toBe('▾ Previous agents (1)');
  } finally { release(); await pending; await parent.unmount(); await child.unmount(); }
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
  dependencies(on, undefined, undefined, ($, e) => {
    cancelled = e.argv;
    return { value: { exitCode: 0, stdout: '{"requested":true}', stderr: '' } };
  });
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
  const pending = collect($.turn.step(STEP));
  await ready;
  const ui = await $.ui.mount({ plugin: 'codex', surface: 'terminal', ...PANE });
  expect(await ui.find({ type: 'Button', text: 'Stop Codex' })).toBeDefined();
  await ui.press({ key: `stop-${runId}` });
  expect(cancelled[2]).toBe('cancel');
  expect(cancelled[3]).toBe(runId);
  expect(await ui.find({ type: 'Text', text: '1 active agent' })).toBeDefined();
  expect((await ui.find({ key: 'select-native-agent' }))?.text).toMatch('stopping');
  expect(await ui.find({ key: 'toggle-previous' })).toBeUndefined();
  release();
  expect((await pending).text).toMatch('Codex task interrupted.');
  await ui.unmount();
});


test('background Agent handles point to the saved Codex report, preserving launch feedback', async ($, on) => {
  on('agent.spawn', () => ({ agentId: 'native-agent', model: 'unused' }));
  dependencies(on, undefined, undefined, ($, e) => {
    expect(e.argv[2]).toBe('bind-output');
    expect(e.argv[4]).toBe('/tmp/tasks/native-agent.output');
    expect(e.argv[5]).toBe('native-agent');
    return { value: { exitCode: 0, stdout: '{"bound":true}', stderr: '' } };
  });
  on('tool.call', { tool: 'Agent' }, () => ({ result: { isAsync: true, agentId: 'native-agent', outputFile: '/tmp/tasks/native-agent.output', description: 'Implement fix' } }));
  await $.agent.spawn({ subagentType: TYPE, prompt: 'Implement the fix.', description: 'Implement fix', tool_use_id: 'report-tool',
    provider: { plugin: 'codex', tier: 'user' }, parentModel: 'unused', background: true, fork: false });
  const launched = await $.tool.call({ tool: 'Agent', tool_use_id: 'report-tool', subagent_type: TYPE, prompt: 'Implement the fix.', description: 'Implement fix' });
  expect(launched.result.outputFile).toBe('/tmp/tasks/native-agent.output');
  expect(launched.result.agentId).toBe('native-agent');
  expect(launched.result.description).toBe('Implement fix');

});
