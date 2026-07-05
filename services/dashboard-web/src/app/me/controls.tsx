'use client';
import { useTransition } from 'react';
import { decideActionAction, runReviewAction } from './actions';

export function DecisionButtons({ actionId }: { actionId: string }) {
  const [pending, start] = useTransition();
  const decide = (d: 'accept' | 'reject' | 'complete') => start(() => decideActionAction(actionId, d));
  return (
    <span style={{ display: 'flex', gap: 5 }}>
      <button type="button" disabled={pending} className="btn btn-ok" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('accept')}>Accept</button>
      <button type="button" disabled={pending} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('reject')}>Decline</button>
      <button type="button" disabled={pending} className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => decide('complete')}>Done</button>
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
