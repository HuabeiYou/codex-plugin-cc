// TEST ONLY. Drives a real foreground Agent call with scripted parent responses.
// The native worker still runs the real Codex harness (or a fake on PATH).
let child = null;
let result = null;
let steps = 0;
const bridgeEvents = [];
let cancelMode = false;
let stopped = null;
let backgroundMode = false;
let feedback = null;
let childMessages = [];
const activityNotices = [];
const openedPanes = [];
const bridgeControls = [];
const launches = [];
const completions = [];
let reuseMode = false;
let realWorkflowMode = false;
const feedbackCheckpoints = [];
const feedbackReceipts = [];
const reportReads = [];
const requestBaselines = new Map();

async function waitForFeedbackCheckpoint($, index) {
  const ready = bridgeEvents.filter((event) => event.kind === 'ready')[index];
  if (!ready?.reportFile) throw new Error('Initial worker report binding is missing.');
  const response = await $.process.run(['node', `${$.plugin.root}/scripts/wait-for-report.mjs`, ready.reportFile, requestBaselines.get(index)]);
  if (response.exitCode !== 0) throw new Error(response.stderr || 'Real feedback did not deliver a completed report.');
  feedbackCheckpoints.push({ ...JSON.parse(response.stdout), agentId: launches[index].agentId });
  return ready.reportFile;
}
export function register(on) {
  on('process.run', async ($, e, next) => {
    const response = await next(e);
    if (e.argv.some((arg) => arg.endsWith('/scripts/native-bridge.mjs') || arg.endsWith('/scripts/bridge.mjs'))) bridgeControls.push({ command: e.argv[2], response });
    return response;
  });
  on('session.append', async ($, e, next) => {
    const stored = await next(e);
    if (e.agentId && e.message.type === 'system') activityNotices.push({ agentId: e.agentId, text: e.message.content.map((c) => c.text || '').join(''), stored: !stored.deny });
    return stored;
  });
  on('ui.open', async ($, e, next) => {
    openedPanes.push(e.id);
    return next(e);
  });
  on('process.spawn', async function* ($, e, next) {
    if (e.argv[2] !== 'run' || !e.argv.some((arg) => arg.endsWith('/scripts/bridge.mjs') || arg.endsWith('/scripts/native-bridge.mjs'))) return yield* next(e);
    let buffer = '';
    const stream = next(e);
    while (true) {
      const item = await stream.next();
      if (item.done) return item.value;
      const chunk = item.value;
      if (chunk.stream === 'stdout') {
        const lines = (buffer + chunk.text).split('\n');
        buffer = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.kind !== 'text') bridgeEvents.push({ ...event, receivedAt: Date.now() });
        }
      }
      yield chunk;
    }
  });
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      child = { agentId: e.agentId, answer: e.answer, isAborted: e.isAborted, reason: e.reason, turnId: e.turnId };
      completions.push(child);
      const found = await $.session.messages({ agentId: e.agentId });
      if (Array.isArray(found)) childMessages = found;
    }
    return next(e);
  });
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const response = await next(e);
    result = response;
    if (response.result?.agentId) launches.push(response.result);
    return response;
  });
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const response = await next(e);
    stopped = { taskId: e.task_id, isError: response.isError ?? false };
    return response;
  });
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const response = await next(e);
    feedback = { isError: response.isError ?? false, text: JSON.stringify(response.result) };
    if (realWorkflowMode) reportReads.push(feedback);
    return response;
  });
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const response = await next(e);
    if (realWorkflowMode) feedbackReceipts.push({ requestedAgentId: e.to, isError: response.isError ?? false, result: response.result });
    return response;
  });
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    steps++;
    if (steps === 1) {
      const task = await $.env.get('CODEX_NATIVE_ACCEPTANCE_TASK') || 'Read README.md and describe this repository in one sentence. Do not edit anything.';
      cancelMode = await $.env.get('CODEX_NATIVE_ACCEPTANCE_CANCEL') === '1';
      backgroundMode = await $.env.get('CODEX_NATIVE_ACCEPTANCE_BACKGROUND') === '1';
      reuseMode = await $.env.get('CODEX_NATIVE_ACCEPTANCE_REUSE') === '1';
      realWorkflowMode = await $.env.get('CODEX_NATIVE_ACCEPTANCE_REAL_WORKFLOW') === '1';
      const input = { subagent_type: await $.env.get('CODEX_NATIVE_ACCEPTANCE_AGENT_TYPE') || 'codex-native-prototype:worker', description: 'Native acceptance', prompt: task, run_in_background: backgroundMode || cancelMode };
      yield { kind: 'tool', index: 0, id: 'native_acceptance_agent', name: 'Agent' };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: 'Agent', input }], stopReason: 'tool_use', usage: null };
    }
    if (reuseMode && (steps === 2 || steps === 3)) {
      const input = { subagent_type: await $.env.get('CODEX_NATIVE_ACCEPTANCE_AGENT_TYPE'),
        description: steps === 2 ? 'Adversarial reviewer' : 'Unrelated topic',
        prompt: JSON.stringify({ write: false, task: realWorkflowMode
          ? steps === 2 ? 'Read greeting.mjs and greeting.test.mjs. Review whether greet("") returns "Hello, world!" as required. Report the concrete mismatch and remedy. Do not edit files or configuration.' : 'Read greeting.test.mjs and describe its test coverage in one sentence. Do not edit files or configuration.'
          : steps === 2 ? 'Adversarial review of the implementation.' : 'Investigate another topic.' }),
        run_in_background: false };
      yield { kind: 'tool', index: 0, id: `native_acceptance_topic_${steps}`, name: 'Agent' };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: 'Agent', input }], stopReason: 'tool_use', usage: null };
    }
    if (realWorkflowMode && (steps === 5 || steps === 7)) {
      const input = { file_path: await waitForFeedbackCheckpoint($, steps === 5 ? 0 : 1) };
      yield { kind: 'tool', index: 0, id: `native_acceptance_read_feedback_${steps}`, name: 'Read' };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: 'Read', input }], stopReason: 'tool_use', usage: null };
    }
    if (reuseMode && (steps === 4 || steps === (realWorkflowMode ? 6 : 5))) {
      if (!realWorkflowMode && steps === 5) {
        for (let attempt = 0; attempt < 80 && bridgeEvents.filter((event) => event.kind === 'result').length < 4; attempt++) await $.clock.sleep(100);
        if (bridgeEvents.filter((event) => event.kind === 'result').length < 4) throw new Error('Implementation feedback did not execute a Codex turn.');
      }
      const index = steps === 4 ? 0 : 1;
      if (realWorkflowMode) {
        const ready = bridgeEvents.filter((event) => event.kind === 'ready')[index];
        const checkpoint = JSON.parse(await $.fs.read(ready.reportFile + '.checkpoint.json'));
        requestBaselines.set(index, checkpoint.requestId);
      }
      const input = { to: launches[index].agentId,
        message: realWorkflowMode
          ? index === 0 ? 'Update your original greeting.mjs so greet("") returns "Hello, world!" while greet("Ada") still returns "Hello, Ada!". Add the empty-name regression case to greeting.test.mjs and run node --test greeting.test.mjs. Only edit those two files; do not commit, install packages, or change configuration.' : 'The implementation now handles an empty name. Re-read greeting.mjs and greeting.test.mjs, run node --test greeting.test.mjs, and re-review your original finding. Report whether resolved, still open, or newly introduced. Do not edit files or configuration.'
          : index === 0 ? 'Fix the review findings on your original implementation.' : 'I addressed your findings. Re-review the revised implementation.',
        summary: index === 0 ? 'Address original implementation review findings' : 'Re-review revised implementation after your feedback' };
      yield { kind: 'tool', index: 0, id: `native_acceptance_feedback_${index}`, name: 'SendMessage' };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: 'SendMessage', input }], stopReason: 'tool_use', usage: null };
    }
    if (reuseMode) {
      if (!realWorkflowMode) {
        for (let attempt = 0; attempt < 80 && bridgeEvents.filter((event) => event.kind === 'result').length < 5; attempt++) await $.clock.sleep(100);
        if (bridgeEvents.filter((event) => event.kind === 'result').length < 5) throw new Error('Re-review feedback did not execute a Codex turn.');
      }
      await $.clock.sleep(200);
      const answer = JSON.stringify({ launches, completions, bridgeEvents, bridgeControls, openedPanes, feedbackCheckpoints, feedbackReceipts, reportReads });
      yield { kind: 'text', index: 0, text: answer };
      yield { kind: 'stop', stopReason: 'end_turn', usage: null };
      return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null };
    }
    if (backgroundMode && !cancelMode && steps === 2) {
      for (let attempt = 0; attempt < 300 && !child; attempt++) await $.clock.sleep(100);
      if (!child) throw new Error('Worker did not deliver completion feedback.');
      const input = { file_path: result.result.outputFile };
      yield { kind: 'tool', index: 0, id: 'native_acceptance_output', name: 'Read' };
      yield { kind: 'input', index: 0, json: JSON.stringify(input) };
      yield { kind: 'stop', stopReason: 'tool_use', usage: null };
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: 'Read', input }], stopReason: 'tool_use', usage: null };
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
    const answer = JSON.stringify({ child, agentId: result?.result?.agentId, stopped, feedback, bridgeEvents, bridgeControls, activityNotices, childMessages, openedPanes, scriptedParentSteps: steps });
    yield { kind: 'text', index: 0, text: answer };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null };
  });
}
