'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useUniverse } from './UniverseProvider';
import { summonJarvis } from './UniverseZone';

/**
 * Phase AF.4.1 — the Overview "Active Operations" module.
 *
 * Directly answers the real-user-test complaint: after a refresh, the user
 * had to go to Tasks, find the task, and open Mission Control to understand
 * what Jarvis had done — nothing on the homepage survived a reload. This
 * panel reads from `UniverseProvider`'s `liveState` (seeded server-side on
 * first paint from `GET /v1/operator/live-state`, refreshed client-side on
 * the same 'live-pulse' block invalidation every operator lifecycle event
 * already triggers — see `realtimeBlocks.ts`). Every field rendered here is
 * a real, persisted record; an empty section renders nothing rather than a
 * placeholder, and the whole panel is omitted when there is genuinely
 * nothing to show (never a fake "no activity" filler card).
 *
 * "Dismiss" only hides the panel in local component state for this page
 * view — it never deletes or mutates any backend record, and the panel
 * reappears the next time `liveState` has real content (e.g. after
 * navigating back, or on the next 'live-pulse' refresh).
 */
export function ActiveOperationsPanel() {
  const { liveState } = useUniverse();
  const [dismissed, setDismissed] = useState(false);

  if (!liveState || dismissed) return null;
  const { activeSessions, recentSessions, pendingApprovals, recentTasks, recentEvents } = liveState;
  const hasContent = activeSessions.length > 0 || pendingApprovals.length > 0 || recentSessions.length > 0 || recentEvents.length > 0;
  if (!hasContent) return null;

  // Most-recent finished session not currently superseded by an active one —
  // this is the "completion/failure result" the user shouldn't have to hunt
  // through Tasks for.
  const lastResult = activeSessions.length === 0 ? recentSessions[0] : null;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="label">Active operations</span>
        <button type="button" className="chip" style={{ cursor: 'pointer', fontSize: 10 }} onClick={() => setDismissed(true)} title="Hide for this view — reappears when there's new activity">Dismiss</button>
      </div>

      {activeSessions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: pendingApprovals.length || lastResult ? 10 : 0 }}>
          {/* Phase AF.4.4 — the backend snapshot can now return up to 20
              active sessions (raised from 5, a correctness fix so a still-
              running operation never silently vanishes from the feed — see
              docs/decision-log.md D-12x). This concise Overview module stays
              capped at 4 visible rows regardless, with an honest "+N more"
              link into the full Jarvis shell rather than growing unbounded;
              the scrollable Live Activity feed below is where all of them
              are always visible as real operation cards. */}
          {activeSessions.slice(0, 4).map((s) => (
            <div key={s.runtimeSessionId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass-2)' }}>
              <span className="op-active-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.goal}</div>
                <div className="m" style={{ fontSize: 10.5 }}>{s.status.replace(/_/g, ' ')}{s.nextAction ? ` — ${s.nextAction.slice(0, 80)}` : ''}</div>
              </div>
              <button type="button" className="chip" style={{ cursor: 'pointer', fontSize: 10 }} onClick={() => summonJarvis('')}>Open Jarvis</button>
            </div>
          ))}
          {activeSessions.length > 4 && (
            <button type="button" className="chip" style={{ cursor: 'pointer', fontSize: 10, alignSelf: 'flex-start' }} onClick={() => summonJarvis('')}>
              +{activeSessions.length - 4} more active — open Jarvis
            </button>
          )}
        </div>
      )}

      {pendingApprovals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: lastResult ? 10 : 0 }}>
          <span className="label" style={{ fontSize: 10 }}>Waiting on you</span>
          {pendingApprovals.slice(0, 3).map((p) => (
            <div key={p.permissionId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 6, border: `1px solid ${p.riskLevel === 'critical' || p.riskLevel === 'high' ? 'rgba(255,107,129,0.45)' : 'var(--border-2)'}`, background: 'var(--glass-2)' }}>
                <span className={`badge ${p.riskLevel === 'critical' || p.riskLevel === 'high' ? 'err' : 'warn'}`} style={{ flexShrink: 0 }}>{p.riskLevel}</span>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.prompt}</div>
                <button type="button" className="chip" style={{ cursor: 'pointer', fontSize: 10 }} onClick={() => summonJarvis('')}>Review</button>
              </div>
          ))}
        </div>
      )}

      {lastResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass-2)', marginBottom: 10 }}>
          <span className={`badge ${lastResult.status === 'completed' ? 'ok' : 'err'}`} style={{ flexShrink: 0 }}>{lastResult.status}</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastResult.composedReply || lastResult.reportSummary || lastResult.goal}</div>
        </div>
      )}

      {recentTasks.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {recentTasks.slice(0, 3).map((t) => (
            <Link key={t.taskId} href={`/tasks/${t.taskId}`} className="chip" style={{ fontSize: 10.5, textDecoration: 'none' }}>{t.status}: {t.goal.slice(0, 40)} →</Link>
          ))}
        </div>
      )}
    </div>
  );
}
