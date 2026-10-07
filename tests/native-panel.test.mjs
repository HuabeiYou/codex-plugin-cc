import assert from 'node:assert/strict';
import test from 'node:test';
import { PaneState, paneActivity, agentHeader } from '../plugins/codex-native-prototype/hooks/panel.mjs';
import { createRun, acceptEvent, setRunStatus } from '../plugins/codex-native-prototype/hooks/protocol.mjs';

const workers = (count) => Array.from({ length: count }, (_, i) => createRun(`agent-${i}`, `Task ${i}`, `run-${i}`));

test('paging selects a visible agent and does not wrap past the first or last page', () => {
  const runs = workers(12);
  const state = new PaneState();
  assert.equal(state.view(runs).selected, runs[0]);
  state.page('active', 1, runs);
  assert.equal(state.view(runs).selected, runs[5]);
  state.page('active', 1, runs);
  assert.equal(state.view(runs).selected, runs[10]);
  state.page('active', 1, runs);
  assert.equal(state.activePage, 2);
  state.page('active', -1, runs);
  assert.equal(state.view(runs).selected, runs[5]);
});

test('a completion on an earlier page keeps the selected active row visible', () => {
  const runs = workers(6);
  const state = new PaneState();
  state.page('active', 1, runs);
  assert.equal(state.view(runs).selected, runs[5]);
  setRunStatus(runs[0], 'completed');
  const view = state.view(runs);
  assert.equal(state.activePage, 0);
  assert.ok(view.activeRows.includes(view.selected));
  assert.equal(view.selected, runs[5]);
});

test('finishing the selected agent keeps attention on active work even with history open', () => {
  const runs = workers(2);
  const state = new PaneState();
  state.view(runs);
  state.toggleHistory();
  setRunStatus(runs[0], 'completed');
  assert.equal(state.view(runs).selected, runs[1]);
  assert.equal(state.historyOpen, true);
});

test('history is folded by default and lists agents by completion order', () => {
  const runs = workers(3);
  setRunStatus(runs[1], 'completed');
  setRunStatus(runs[2], 'failed');
  setRunStatus(runs[0], 'interrupted');
  const state = new PaneState();
  assert.equal(state.view(runs).selected, undefined);
  assert.equal(state.historyOpen, false);
  state.toggleHistory();
  const view = state.view(runs);
  assert.deepEqual(view.previous, [runs[0], runs[2], runs[1]]);
  assert.equal(view.selected, runs[0]);
  assert.equal(view.failedCount, 1);
  const order = runs[0].finishedOrder;
  setRunStatus(runs[0], 'interrupted');
  assert.equal(runs[0].finishedOrder, order, 'redraw/abort feedback must not reorder unchanged history');
});

test('history pagination is independent and closing it restores active selection', () => {
  const runs = workers(8);
  runs.slice(0, 6).forEach((run) => setRunStatus(run, 'completed'));
  const state = new PaneState();
  state.view(runs);
  state.toggleHistory();
  state.page('previous', 1, runs);
  assert.equal(state.view(runs).selected, runs[0]);
  assert.equal(state.activePage, 0);
  state.toggleHistory();
  assert.equal(state.view(runs).selected, runs[6]);
});

test('parent and child views retain their own selection and expansion preferences', () => {
  const runs = workers(2);
  const parent = new PaneState();
  const child = new PaneState(runs[1].agentId);
  parent.view(runs);
  parent.toggleActivity(runs[0].agentId);
  child.view(runs);
  assert.equal(parent.view(runs).selected, runs[0]);
  assert.equal(child.view(runs).selected, runs[1]);
  parent.select(runs[1]);
  parent.select(runs[0]);
  assert.equal(parent.expandedAgents.has(runs[0].agentId), true);
  assert.equal(child.expandedAgents.size, 0);
  setRunStatus(runs[1], 'completed');
  assert.equal(child.view(runs).selected, runs[1]);
  assert.equal(child.historyOpen, true, 'the finished child keeps its own activity visible');
  assert.equal(parent.historyOpen, false);
});

test('resuming a previous agent removes its old completion order and restores active classification', () => {
  const [run] = workers(1);
  setRunStatus(run, 'interrupted');
  assert.ok(run.finishedOrder);
  acceptEvent(run, { kind: 'ready', threadId: 'thread', model: 'model', effort: 'high' });
  const view = new PaneState().view([run]);
  assert.equal(run.finishedOrder, null);
  assert.deepEqual(view.active, [run]);
  assert.deepEqual(view.previous, []);
});

test('compact activity coalesces item lifecycles and output while expanded activity retains every event', () => {
  const [run] = workers(1);
  run.threadId = 'main';
  const emit = (event) => acceptEvent(run, { kind: 'activity', threadId: 'main', turnId: 'turn', ...event });
  emit({ type: 'thread', label: 'Codex thread', status: 'starting' });
  emit({ type: 'turn', label: 'Codex turn started', status: 'running' });
  emit({ itemId: 'command', type: 'commandExecution', label: 'npm test', status: 'running' });
  emit({ itemId: 'command', type: 'commandOutput', label: '1 test passed', status: 'running' });
  emit({ itemId: 'command', type: 'commandOutput', label: '2 tests passed', status: 'running' });
  emit({ itemId: 'command', type: 'commandExecution', label: 'npm test', status: 'completed' });
  const before = structuredClone(run.activity);
  assert.deepEqual(paneActivity(run).map((entry) => entry.text), ['› 2 tests passed', '✓ npm test']);
  assert.equal(paneActivity(run, true).length, 6);
  assert.deepEqual(run.activity, before);
});

test('the same command in different items, turns, and child threads stays distinct', () => {
  const [run] = workers(1);
  run.threadId = 'main';
  for (const [itemId, turnId, threadId] of [['a', 'one', 'main'], ['b', 'one', 'main'], ['a', 'two', 'main'], ['a', 'one', 'child']]) {
    acceptEvent(run, { kind: 'activity', itemId, turnId, threadId, type: 'commandExecution', label: 'npm test', status: 'completed' });
  }
  assert.equal(paneActivity(run).length, 4);
  assert.equal(paneActivity(run).at(-1).text, '✓ ↳ npm test');
});

test('compact activity remains sanitized and expands multiline terminal output safely', () => {
  const [run] = workers(1);
  acceptEvent(run, { kind: 'activity', label: '\u001b[32mDownload 10%\rDownload 20%\u001b[0m', status: 'running' });
  assert.equal(paneActivity(run)[0].text, '› Download 10% Download 20%');
  assert.equal(paneActivity(run, true)[0].text, 'Download 10%\nDownload 20% [running]');
});

test('narrow headers preserve effort and status while bounding and sanitizing model names', () => {
  const [run] = workers(1);
  run.model = '\u001b[32ma-very-long-model-name\nwith-extra-text\u001b[0m';
  run.effort = 'high';
  setRunStatus(run, 'running');
  const narrow = agentHeader(run, 44, true);
  assert.ok(narrow.length + 3 <= 44, 'the header leaves room for the numeric hotkey');
  assert.match(narrow, / · high · running$/);
  assert.doesNotMatch(narrow, /[\n\u001b]/);
  assert.match(agentHeader(run, 100, false), / · high thinking · running$/);
});

test('a shorter pane reduces page size without losing selection or retained activity', () => {
  const runs = workers(6);
  const state = new PaneState();
  state.page('active', 1, runs);
  assert.equal(state.view(runs).selected, runs[5]);
  state.pageSize = 2;
  const small = state.view(runs);
  assert.equal(small.activePages, 3);
  assert.equal(state.activePage, 2);
  assert.ok(small.activeRows.includes(runs[5]));
  acceptEvent(runs[5], { kind: 'activity', label: 'check', status: 'running' });
  assert.deepEqual(paneActivity(runs[5], false, 0), []);
  assert.equal(paneActivity(runs[5], true, 0).length, 1);
  assert.equal(runs[5].activity.length, 1);
});
