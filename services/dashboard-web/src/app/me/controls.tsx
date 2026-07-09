'use client';
import { useTransition } from 'react';
import { decideActionAction, decideOpportunityAction, runReviewAction } from './actions';

/**
 * Phase AF.4 — `onDecided` is an optional callback fired after the decision
 * server action resolves, used by the Domain Canvas (`PriorityStack`) to
 * refresh exactly the real affected blocks via `useOptionalRefresh()`. The
 * `/me` pages that already render this component don't pass it — they rely
 * on Next's normal `revalidatePath`-driven re-render, unchanged.
 */
export function DecisionButtons({ actionId, onDecided }: { actionId: string; onDecided?: () => void }) {
  const [pending, start] = useTransition();
  const decide = (d: 'accept' | 'reject' | 'complete') => start(async () => { await decideActionAction(actionId, d); onDecided?.(); });
  return (
    <span style={{ display: 'flex', gap: 5 }}>
      <button type="button" disabled={pending} className="btn btn-ok" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('accept')}>Accept</button>
      <button type="button" disabled={pending} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('reject')}>Decline</button>
      <button type="button" disabled={pending} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('complete')}>Done</button>
    </span>
  );
}

/** Phase AF.3 — mirrors DecisionButtons for the Opportunity Radar zone,
 *  reusing the same useTransition pattern rather than inventing a new one.
 *  Phase AF.4 — same optional `onDecided` refresh hook as above. */
export function OpportunityDecisionButtons({ opportunityId, onDecided }: { opportunityId: string; onDecided?: () => void }) {
  const [pending, start] = useTransition();
  const decide = (d: 'accept' | 'reject' | 'follow_up') => start(async () => { await decideOpportunityAction(opportunityId, d); onDecided?.(); });
  return (
    <span style={{ display: 'flex', gap: 5 }}>
      <button type="button" disabled={pending} className="btn btn-ok" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('accept')}>Save</button>
      <button type="button" disabled={pending} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('follow_up')}>Follow up</button>
      <button type="button" disabled={pending} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('reject')}>Reject</button>
    </span>
  );
}

export function RunReviewButton({ type, label }: { type: 'daily' | 'weekly'; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12.5 }} onClick={() => start(() => runReviewAction(type))}>
      {pending ? 'Running…' : label}
    </button>
  );
}
