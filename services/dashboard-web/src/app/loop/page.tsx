import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import Link from 'next/link';
import { AutoRefresh, TickButton, DecisionButtons } from './controls';
export const dynamic = 'force-dynamic';

/**
 * Living Loop console (CIN-2b, D-181) — every cycle shows the full story:
 * what Jarvis saw, why it mattered, what it decided, what it did, and what
 * happened. Auto-refreshes every 5s (live view of the autonomous loop).
 */
export default async function LoopPage() {
  const [cyclesRes, inboxRes, deadRes] = await Promise.all([
    gateway.loopCycles(30),
    gateway.loopInbox(),
    gateway.loopInbox('dead'),
  ]);
  const cycles = cyclesRes?.cycles ?? [];
  const latency = inboxRes?.latency ?? { count: 0, p50: null, p95: null };
  const dead = deadRes?.events ?? [];

  return (
    <>
      <AutoRefresh seconds={5} />
      <h1 className="h1">Autonomous Living Loop</h1>
      <p className="sub">
        observe → snapshot → assess → reason → plan → execute → review → update.
        Latency p50 {latency.p50 ?? '—'}ms · p95 {latency.p95 ?? '—'}ms over {latency.count} events. <TickButton />
      </p>

      {dead.length > 0 && (
        <div className="card">
          <h2>Dead letters ({dead.length})</h2>
          <table>
            <thead><tr><th>Type</th><th>Attempts</th><th>Last error</th><th>Received</th></tr></thead>
            <tbody>
              {dead.map((e) => (
                <tr key={String(e.inboxId)}>
                  <td><span className="badge">{String(e.type)}</span></td>
                  <td className="m">{String(e.attempts)}/{String(e.maxAttempts)}</td>
                  <td className="m">{String(e.lastError).slice(0, 80)}</td>
                  <td className="m">{timeAgo(String(e.receivedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Cycles ({cycles.length})</h2>
        {cycles.length === 0 ? (
          <div className="empty">No cycles yet. The loop ticks every minute; events from the heartbeat and the event fabric start cycles automatically.</div>
        ) : (
          cycles.map((c) => {
            const stages = (c.stages as Array<{ stage: string; at: string; durationMs: number; ok: boolean; summary: string }>) ?? [];
            const decision = c.decision as { rationale: string; priority: string; usedModel: boolean; usedFallback: boolean } | null;
            const plan = (c.plan as Array<{ stepId: string; title: string; toolName: string; status: string; requiresApproval: boolean; resultSummary: string }>) ?? [];
            const outcome = c.outcome as { ok: boolean; summary: string; ledgerSeq: number | null } | null;
            return (
              <div key={String(c.cycleId)} className="glass" style={{ padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="badge">{String(c.status)}</span>
                  <strong>{String(c.triggerSummary)}</strong>
                  <span className="m">{String(c.cycleId)} · {timeAgo(String(c.createdAt))}</span>
                  {c.replayOf ? <span className="badge">replay</span> : null}
                  {decision ? <span className="badge">{decision.priority}{decision.usedModel ? ' · model' : ' · fallback'}</span> : null}
                  {String(c.status) === 'awaiting_approval' ? <DecisionButtons cycleId={String(c.cycleId)} /> : null}
                </div>
                {decision ? <p className="m" style={{ margin: '6px 0' }}>why: {decision.rationale.slice(0, 220)}</p> : null}
                <div style={{ fontSize: 12 }}>
                  {stages.map((s, i) => (
                    <div key={i} className="m">
                      [{s.at.slice(11, 19)}] {s.ok ? '✓' : '✗'} <strong>{s.stage}</strong> ({s.durationMs}ms) — {s.summary.slice(0, 160)}
                    </div>
                  ))}
                  {plan.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {plan.map((s) => (
                        <div key={s.stepId} className="m">
                          → {s.title} <span className="badge">{s.toolName}</span> <span className="badge">{s.status}</span>
                          {s.resultSummary ? ` — ${s.resultSummary.slice(0, 100)}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {outcome ? <div className="m" style={{ marginTop: 4 }}>result: {outcome.ok ? '✓' : '✗'} {outcome.summary}{outcome.ledgerSeq !== null ? ` · ledger #${outcome.ledgerSeq}` : ''}</div> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <p className="m">Spec &amp; acceptance gates: <Link href="/docs">docs/cin-v2/living-loop.md</Link> · <Link href="/cin">CIN overview</Link></p>
    </>
  );
}
