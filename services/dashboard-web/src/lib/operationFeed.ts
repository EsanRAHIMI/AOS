/**
 * Phase AF.4.3 — pure grouping logic behind the "Live Activity" module.
 *
 * The bug being fixed: `LiveEvents` used to render the raw `events`
 * collection one row per event, with no grouping — a single Jarvis goal
 * produced 4-5 separate lines (session started, approval requested, tool
 * failed, session completed, ...) that never updated in place, so the feed
 * looked like a raw log dump and grew without bound.
 *
 * The fix: group by the real, stable identity each event/session/task/
 * approval already carries — `runtimeSessionId` for a Jarvis operation,
 * `taskId` for a kernel task — and fold everything belonging to the same
 * operation into ONE item that's updated (status/latest message/history),
 * never appended as a new row. An approval is not a separate operation from
 * its session — a pending `OperatorToolPermission` is merged into its
 * session's card via the shared `runtimeSessionId`, exactly matching the
 * product requirement's own example ("one operation card ... status:
 * waiting approval"). Only events with no session/task identity at all
 * (`reality.ingested`, `service.registered`, ...) become their own
 * standalone item — which is correct, since each of those genuinely IS one
 * self-contained occurrence, not a multi-step operation.
 *
 * Kept dependency-free (no React, no app-specific types) so it's directly
 * unit-testable, matching `eventDedupe.ts`'s precedent.
 */

export interface FeedSessionInput {
  runtimeSessionId: string;
  goal: string;
  status: string;
  nextAction: string;
  reportSummary: string;
  composedReply: string;
  startedAt: string;
  completedAt: string | null;
}

export interface FeedApprovalInput {
  permissionId: string;
  runtimeSessionId: string;
  prompt: string;
  riskLevel: string;
  createdAt: string;
}

export interface FeedTaskInput {
  taskId: string;
  goal: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedEventInput {
  type: string;
  message: string;
  createdAt: string;
  runtimeSessionId: string | null;
  taskId: string | null;
  permissionId: string | null;
  source?: string;
}

export type OperationKind = 'session' | 'task' | 'event';
export type OperationTone = 'ok' | 'warn' | 'err' | 'neutral';

export interface OperationFeedItem {
  key: string;
  kind: OperationKind;
  title: string;
  status: string;
  statusTone: OperationTone;
  latestMessage: string;
  source: string;
  meta: string;
  updatedAt: string;
  href: string | null;
  /** Collapsed-by-default secondary detail — recent merged messages, newest
   *  first, capped small. Not rendered as separate top-level rows. */
  history: string[];
}

export function humanizeEventType(type: string): string {
  return type.replace(/[._]/g, ' ');
}

function sessionStatusView(status: string): { label: string; tone: OperationTone } {
  switch (status) {
    case 'planning': return { label: 'planning', tone: 'neutral' };
    case 'running': case 'verifying': return { label: 'running', tone: 'neutral' };
    case 'waiting_approval': return { label: 'waiting approval', tone: 'warn' };
    case 'waiting_user_input': return { label: 'waiting on you', tone: 'warn' };
    case 'completed': return { label: 'completed', tone: 'ok' };
    case 'failed': return { label: 'failed', tone: 'err' };
    case 'cancelled': return { label: 'cancelled', tone: 'neutral' };
    default: return { label: status.replace(/_/g, ' '), tone: 'neutral' };
  }
}

function taskStatusTone(status: string): OperationTone {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'err';
  if (status === 'awaiting_approval' || status === 'pending') return 'warn';
  return 'neutral';
}

const HISTORY_CAP = 6;

/**
 * Builds one card per real operation. `sessions` should be the union of
 * active + recently-terminal sessions from the live-state snapshot;
 * `approvals` the pending approvals; `tasks` the recent kernel tasks;
 * `events` the recent/live event stream (snapshot + SSE, already deduped
 * by the caller via `eventDedupe.ts` if desired — this function tolerates
 * duplicates fine since it only ever updates a card, never appends a row).
 */
export function buildOperationFeed(
  input: { sessions: FeedSessionInput[]; approvals: FeedApprovalInput[]; tasks: FeedTaskInput[]; events: FeedEventInput[] },
  limit = 30,
): OperationFeedItem[] {
  const items = new Map<string, OperationFeedItem>();

  for (const s of input.sessions) {
    if (!s.runtimeSessionId) continue;
    const { label, tone } = sessionStatusView(s.status);
    items.set(`session:${s.runtimeSessionId}`, {
      key: `session:${s.runtimeSessionId}`, kind: 'session', title: s.goal || 'Jarvis operation',
      status: label, statusTone: tone,
      latestMessage: s.composedReply || s.reportSummary || s.nextAction || '',
      source: 'jarvis', meta: '', updatedAt: s.completedAt || s.startedAt || '', href: null, history: [],
    });
  }

  // An approval is part of its session's card, not a separate operation —
  // merge by the shared runtimeSessionId. Only if a pending approval
  // somehow references a session not in this snapshot does it become its
  // own standalone card, so nothing real is ever silently dropped.
  for (const a of input.approvals) {
    const key = a.runtimeSessionId ? `session:${a.runtimeSessionId}` : `approval:${a.permissionId}`;
    const existing = items.get(key);
    if (existing) {
      existing.status = 'waiting approval';
      existing.statusTone = 'warn';
      existing.meta = `${a.riskLevel} risk`;
      if (!existing.latestMessage) existing.latestMessage = a.prompt;
      if (a.createdAt > existing.updatedAt) existing.updatedAt = a.createdAt;
    } else {
      items.set(key, {
        key, kind: 'session', title: a.prompt.slice(0, 80) || 'Approval requested', status: 'waiting approval', statusTone: 'warn',
        latestMessage: a.prompt, source: 'jarvis', meta: `${a.riskLevel} risk`, updatedAt: a.createdAt, href: null, history: [],
      });
    }
  }

  for (const t of input.tasks) {
    if (!t.taskId) continue;
    items.set(`task:${t.taskId}`, {
      key: `task:${t.taskId}`, kind: 'task', title: t.goal || 'Kernel task', status: t.status.replace(/_/g, ' '), statusTone: taskStatusTone(t.status),
      latestMessage: '', source: 'kernel', meta: '', updatedAt: t.updatedAt || t.createdAt, href: `/tasks/${t.taskId}`, history: [],
    });
  }

  for (const e of input.events) {
    const targetKey = e.runtimeSessionId ? `session:${e.runtimeSessionId}` : e.taskId ? `task:${e.taskId}` : null;
    const msg = e.message || humanizeEventType(e.type);
    if (targetKey) {
      const existing = items.get(targetKey);
      if (existing) {
        if (!existing.history.includes(msg)) existing.history = [msg, ...existing.history].slice(0, HISTORY_CAP);
        if (e.createdAt >= existing.updatedAt) {
          existing.latestMessage = msg;
          existing.updatedAt = e.createdAt;
          if (e.source) existing.source = e.source;
        }
        continue;
      }
      // Real event referencing a session/task that already aged out of the
      // snapshot's recent-5 window — still real, surfaced as a minimal
      // standalone card rather than dropped.
      items.set(targetKey, {
        key: targetKey, kind: e.runtimeSessionId ? 'session' : 'task', title: msg, status: humanizeEventType(e.type), statusTone: 'neutral',
        latestMessage: msg, source: e.source || 'system', meta: '', updatedAt: e.createdAt,
        href: e.taskId ? `/tasks/${e.taskId}` : null, history: [],
      });
      continue;
    }
    // No session/task identity at all — a genuinely standalone occurrence
    // (reality.ingested, service.registered, ...), not part of any
    // multi-step operation. Keyed by type+timestamp so it appears once.
    const key = `event:${e.type}:${e.createdAt}`;
    if (items.has(key)) continue;
    items.set(key, {
      key, kind: 'event', title: msg, status: humanizeEventType(e.type), statusTone: 'neutral',
      latestMessage: msg, source: e.source || 'system', meta: '', updatedAt: e.createdAt, href: null, history: [],
    });
  }

  return [...items.values()]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, limit);
}
