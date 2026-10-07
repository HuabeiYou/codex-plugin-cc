import { displayText, isActiveRun } from './protocol.mjs';

export const PAGE_SIZE = 5;

// Each Claude view owns its selection; opening a child must not move its parent.
export class PaneState {
  /** @param {string | null} viewAgentId */
  constructor(viewAgentId = null, pageSize = PAGE_SIZE) {
    this.selectedAgentId = viewAgentId;
    this.followViewedAgent = Boolean(viewAgentId);
    this.selectedWasActive = false;
    this.activePage = 0;
    this.previousPage = 0;
    this.historyOpen = false;
    this.pageSize = pageSize;
    this.expandedAgents = new Set();
  }

  view(workers) {
    const active = workers.filter(isActiveRun);
    const previous = workers.filter((run) => !isActiveRun(run))
      .sort((a, b) => (b.finishedOrder ?? 0) - (a.finishedOrder ?? 0));
    const activePages = Math.max(1, Math.ceil(active.length / this.pageSize));
    const previousPages = Math.max(1, Math.ceil(previous.length / this.pageSize));
    this.activePage = Math.min(this.activePage, activePages - 1);
    this.previousPage = Math.min(this.previousPage, previousPages - 1);
    let selected = workers.find((run) => run.agentId === this.selectedAgentId);
    if (selected && !isActiveRun(selected)) {
      if (this.followViewedAgent) this.historyOpen = true;
      else if (this.selectedWasActive || !this.historyOpen) selected = undefined;
    }
    selected ??= active[this.activePage * this.pageSize]
      ?? (this.historyOpen ? previous[this.previousPage * this.pageSize] : undefined);
    this.selectedAgentId = selected?.agentId ?? null;
    this.selectedWasActive = Boolean(selected && isActiveRun(selected));
    // Completions can shift a selected row across a page boundary.
    if (selected) {
      if (isActiveRun(selected)) this.activePage = Math.floor(active.indexOf(selected) / this.pageSize);
      else this.previousPage = Math.floor(previous.indexOf(selected) / this.pageSize);
    }
    return {
      active, previous, selected, activePages, previousPages,
      failedCount: previous.filter((run) => run.status === 'failed').length,
      activeRows: active.slice(this.activePage * this.pageSize, (this.activePage + 1) * this.pageSize),
      previousRows: previous.slice(this.previousPage * this.pageSize, (this.previousPage + 1) * this.pageSize)
    };
  }

  select(run) {
    this.selectedAgentId = run.agentId;
    this.selectedWasActive = isActiveRun(run);
    this.followViewedAgent = false;
  }

  page(group, direction, workers) {
    const current = this.view(workers);
    const history = group === 'previous';
    const rows = history ? current.previous : current.active;
    const pageKey = history ? 'previousPage' : 'activePage';
    const pages = history ? current.previousPages : current.activePages;
    this[pageKey] = Math.max(0, Math.min(pages - 1, this[pageKey] + direction));
    const selected = rows[this[pageKey] * this.pageSize];
    if (selected) this.select(selected);
  }

  toggleHistory() {
    this.historyOpen = !this.historyOpen;
    if (!this.historyOpen && !this.selectedWasActive) {
      this.selectedAgentId = null;
      this.followViewedAgent = false;
    }
  }

  toggleActivity(agentId) {
    if (this.expandedAgents.has(agentId)) this.expandedAgents.delete(agentId);
    else this.expandedAgents.add(agentId);
  }
}

export function displayLine(value, limit = 2400) {
  return displayText(displayText(value).replace(/\s+/g, ' ').trim(), limit);
}

export function agentHeader(run, columns, selected) {
  const effort = displayLine(run.effort ?? 'default', 16);
  const thinking = columns < 64 ? effort : `${effort} thinking`;
  const status = displayLine(run.status, 16);
  const modelLimit = Math.max(10, Math.min(80, columns - thinking.length - status.length - 13));
  return `${selected ? '› ' : '  '}${displayLine(run.model || 'Codex', modelLimit)} · ${thinking} · ${status}`;
}

export function paneActivity(run, expanded = false, compactLimit = 6) {
  let events = run.activity;
  if (!expanded) {
    const latest = new Map();
    events.forEach((event, index) => {
      if (['thread', 'turn'].includes(event.type) && event.threadId === run.threadId) return;
      // Only typed item identity joins lifecycle events. Repeated commands
      // with different IDs, child threads, and raw retained history stay distinct.
      const key = event.itemId
        ? JSON.stringify([event.threadId, event.turnId, event.itemId, event.type])
        : index;
      latest.delete(key);
      latest.set(key, event);
    });
    events = [...latest.values()];
  }
  const visible = expanded ? events.slice(-20) : compactLimit > 0 ? events.slice(-compactLimit) : [];
  return visible.map((event, index) => {
    const child = event.threadId && event.threadId !== run.threadId;
    const prefix = child ? (expanded ? `↳ ${event.threadId} · ` : '↳ ') : '';
    const marker = event.status === 'completed' ? '✓' : event.status === 'failed' ? '×' : '›';
    const text = displayText(expanded
      ? `${prefix}${event.label} [${event.status ?? 'unknown'}]`
      : `${marker} ${prefix}${event.label}`);
    return { key: `activity-${run.id}-${index}`, text: expanded ? text : text.replace(/\s+/g, ' '),
      dim: event.status === 'completed', failed: event.status === 'failed' };
  });
}
