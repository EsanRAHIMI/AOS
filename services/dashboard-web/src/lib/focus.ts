/**
 * Phase AF.1 — Focus Row / Today Command Layer.
 *
 * Pure, framework-free logic (no 'use client', no React import) so it is
 * importable both by the FocusRow component and by a plain Node smoke
 * script — the same testability discipline the shared/src/jarvis modules
 * already use.
 *
 * This is the direct fix for the real failed conversation in Phase AE.1: if
 * the owner has stated an explicit priority, it MUST be the first thing in
 * the row, ahead of blockers, approvals, and — last of all — generic system
 * warnings. System warnings only ever appear when there is genuinely
 * nothing else to show; they can never crowd out a stated priority.
 */

export type FocusItemKind = 'priority' | 'blocker' | 'approval' | 'recommendation' | 'warning';

export interface FocusItem {
  kind: FocusItemKind;
  label: string;
  detail: string;
  /** What to ask Jarvis when the user acts on this item. */
  jarvisCommand: string;
}

export interface FocusBriefingInput {
  primaryPriority: string;
  activeBlockers: string[];
  systemWarnings: string[];
  recommendedNextActions: string[];
}

const MAX_FOCUS_ITEMS = 3;

/** Deterministic: same input ⇒ same row. Never invents content — every
 *  item is a direct, honest read of a real briefing field. */
export function buildFocusItems(briefing: FocusBriefingInput | null, pendingApprovals: number): FocusItem[] {
  const items: FocusItem[] = [];

  if (briefing?.primaryPriority) {
    items.push({
      kind: 'priority',
      label: 'Current priority',
      detail: briefing.primaryPriority,
      jarvisCommand: `Why is "${briefing.primaryPriority}" my priority right now?`,
    });
  }

  for (const blocker of briefing?.activeBlockers ?? []) {
    if (items.length >= MAX_FOCUS_ITEMS) break;
    items.push({ kind: 'blocker', label: 'Active blocker', detail: blocker, jarvisCommand: `Help me resolve: ${blocker}` });
  }

  if (items.length < MAX_FOCUS_ITEMS && pendingApprovals > 0) {
    items.push({
      kind: 'approval',
      label: `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting`,
      detail: 'Decisions unblock execution.',
      jarvisCommand: 'What approvals are pending?',
    });
  }

  for (const action of briefing?.recommendedNextActions ?? []) {
    if (items.length >= MAX_FOCUS_ITEMS) break;
    items.push({ kind: 'recommendation', label: 'Recommended next', detail: action, jarvisCommand: action });
  }

  // System warnings are the LAST resort — only shown when nothing more
  // important exists to fill the row. This is the structural guarantee that
  // generic system health can never displace a real stated priority.
  if (items.length === 0) {
    for (const warning of briefing?.systemWarnings ?? []) {
      if (items.length >= MAX_FOCUS_ITEMS) break;
      items.push({ kind: 'warning', label: 'System warning', detail: warning, jarvisCommand: 'Check the whole system.' });
    }
  }

  return items.slice(0, MAX_FOCUS_ITEMS);
}
