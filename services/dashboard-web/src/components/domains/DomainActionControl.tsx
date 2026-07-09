'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { DomainAction } from '@/lib/domainActions';
import { ingestDomainDataAction } from '@/app/me/actions';
import { createTaskInlineAction } from '@/app/actions';
import { useOptionalRefresh } from '@/components/UniverseProvider';
import { blocksForIngestKind, blocksForTaskCreated } from '@/lib/realtimeBlocks';

/**
 * Phase AF.3 — renders one real, wired control per `DomainAction`:
 *  - `add_data`  → expandable form → `ingestDomainDataAction` → the real,
 *    scope-enforced `POST /v1/me/reality/ingest` (no owner approval needed,
 *    same as it already wasn't for the /me forms this reuses).
 *  - `create_task` → expandable single-field form, pre-filled and editable
 *    → `createTaskInlineAction` (Phase AF.4 — the same real, RBAC-gated
 *    task creation as the dedicated task forms, just without the redirect
 *    that would otherwise navigate away from the homepage).
 *  - `open_link` → a plain chip to a real existing page.
 * Before submitting an add_data action this shows exactly what will be
 * created (kind + the non-empty fields) so the person can see what Jarvis
 * understood before it happens — no separate parallel approval system
 * invented for a class of action (personal data entry) that was never
 * gated by one.
 *
 * Phase AF.4 — on success this now: refreshes exactly the real affected
 * blocks (`useOptionalRefresh` + the `realtimeBlocks` manifest, no full
 * page reload), shows a brief success state, then auto-collapses back to
 * the closed chip. On failure the form stays open with the real error
 * message instead of silently discarding the user's input.
 */
export function DomainActionControl({ action }: { action: DomainAction }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() =>
    action.kind === 'add_data'
      ? Object.fromEntries(action.fields.map((f) => [f.name, f.defaultValue ?? '']))
      : {}
  );
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState(action.kind === 'create_task' ? action.goalTemplate : '');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const refresh = useOptionalRefresh();
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); }, []);

  const succeed = (): void => {
    setDone(true);
    setError('');
    collapseTimer.current = setTimeout(() => { setOpen(false); setDone(false); }, 1400);
  };

  if (action.kind === 'open_link') {
    return <Link href={action.href} className="chip" style={{ fontSize: 10.5, textDecoration: 'none' }}>{action.label}</Link>;
  }

  if (!open) {
    return <button type="button" className="chip" style={{ cursor: 'pointer', fontSize: 10.5 }} onClick={() => { setOpen(true); setDone(false); setError(''); }}>{action.label}</button>;
  }

  if (action.kind === 'add_data') {
    const preview = [`title: ${title || '(required)'}`, ...action.fields.filter((f) => values[f.name]).map((f) => `${f.label.toLowerCase()}: ${values[f.name]}`)].join(' · ');
    return (
      <div className="m" style={{ fontSize: 11, padding: '8px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass-2)', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ fontSize: 12, padding: '5px 8px' }} />
        {action.fields.map((f) => (
          <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 10, width: 90, flexShrink: 0 }}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} style={{ fontSize: 11, flex: 1, padding: '4px 6px' }}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" checked={values[f.name] === 'true'} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked ? 'true' : '' }))} />
            ) : (
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                style={{ fontSize: 11, flex: 1, padding: '4px 6px' }}
              />
            )}
          </div>
        ))}
        <div style={{ fontSize: 10, opacity: 0.7 }}>Will create: {preview}</div>
        {error && <div style={{ fontSize: 10.5, color: 'var(--err)' }}>{error}</div>}
        {done ? (
          <span className="badge ok" style={{ alignSelf: 'flex-start' }}>Saved to your scope</span>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button" disabled={pending || !title.trim()} className="btn btn-ok" style={{ padding: '4px 10px', fontSize: 11 }}
              onClick={() => {
                const fd = new FormData();
                fd.set('kind', action.ingestKind);
                fd.set('title', title);
                for (const f of action.fields) if (values[f.name]) fd.set(f.name, values[f.name]);
                startTransition(async () => {
                  try {
                    await ingestDomainDataAction(fd);
                    setTitle('');
                    refresh(blocksForIngestKind(action.ingestKind));
                    succeed();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not save — try again.');
                  }
                });
              }}
            >{pending ? 'Saving…' : 'Confirm'}</button>
            <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        )}
      </div>
    );
  }

  // create_task
  return (
    <div className="m" style={{ fontSize: 11, padding: '8px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass-2)', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Describe the goal" style={{ fontSize: 12, padding: '5px 8px' }} />
      {error && <div style={{ fontSize: 10.5, color: 'var(--err)' }}>{error}</div>}
      {done ? (
        <span className="badge ok" style={{ alignSelf: 'flex-start' }}>Task created</span>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button" disabled={pending || !goal.trim()} className="btn btn-ok" style={{ padding: '4px 10px', fontSize: 11 }}
            onClick={() => {
              const fd = new FormData();
              fd.set('goal', goal);
              startTransition(async () => {
                try {
                  await createTaskInlineAction(fd);
                  refresh(blocksForTaskCreated());
                  succeed();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not create the task — try again.');
                }
              });
            }}
          >{pending ? 'Creating…' : 'Create task'}</button>
          <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
