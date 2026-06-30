import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { LiveEvents } from '@/components/LiveEvents';
import { OperationCommand } from '@/components/OperationCommand';
import { OperationConsole } from '@/components/OperationConsole';
import { DokployCalibration } from '@/components/DokployCalibration';
import { NextBestAction } from '@/components/NextBestAction';
import { PageHeader, MetricCard, EmptyState, StatusPill } from '@/components/ui';
import { timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [session, status, services, approvals, tasks, reliability, safe] = await Promise.all([
    getSession(),
    gateway.systemStatus(),
    gateway.services() as Promise<Array<Record<string, unknown>> | null>,
    gateway.approvals() as Promise<Array<Record<string, unknown>> | null>,
    gateway.tasks() as Promise<Array<Record<string, unknown>> | null>,
    gateway.reliability() as Promise<Array<Record<string, unknown>> | null>,
    gateway.safeMode(),
  ]);
  const svc = services ?? [];
  const appr = approvals ?? [];
  const latest = (tasks ?? [])[0];
  const reachable = Boolean(status);
  const rels = (reliability ?? []).filter((r) => r.targetType === 'service').sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 4);

  return (
    <>
      <PageHeader
        title="Mission Control"
        subtitle="Start, monitor, approve, verify and understand real operations — all from here. Other pages are archives; the main journey stays on this page."
        actions={<Link href="/start" className="btn btn-ghost">New here? Start guide</Link>}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Command — start a real operation</div>
        <OperationCommand />
        <div className="m" style={{ fontSize: 12.5, marginTop: 10 }}>
          Need an AI / research task instead? Use a real <Link href="/start/actions">action template</Link>. Operations here go through target → risk → approval → execute → verify, safely.
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <OperationConsole role={session?.role ?? 'viewer'} safeMode={Boolean(safe?.enabled)} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <DokployCalibration />
      </div>

      <div style={{ marginBottom: 16 }}>
        <NextBestAction />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Registered services" value={svc.length} hint="in the service registry" />
        <MetricCard label="Tasks" value={status?.taskCount ?? 0} hint="created in the kernel" />
        <MetricCard label="Pending approvals" value={appr.length} tone={appr.length ? 'warn' : undefined} hint={appr.length ? 'need your decision' : 'all clear'} />
        <MetricCard label="Environment" value={<span style={{ fontSize: 20 }}>{status?.env ?? 'unknown'}</span>} tone={reachable ? 'ok' : 'err'} hint={reachable ? 'gateway reachable' : 'gateway unreachable'} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <LiveEvents />
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="label">Pending approvals</span>
            <Link href="/approvals" className="chip">Open</Link>
          </div>
          {appr.length === 0 ? (
            <EmptyState icon="✓" title="Nothing awaiting you" hint="Sensitive actions appear here for approval." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {appr.slice(0, 4).map((a, i) => (
                <Link href="/approvals" key={i} className="glass interactive" style={{ padding: 12, display: 'block' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <b style={{ fontSize: 13.5 }}>{String(a.actionType)}</b>
                    <span className="badge warn">{String(a.riskLevel ?? 'medium')}</span>
                  </div>
                  <div className="m" style={{ fontSize: 12.5, marginTop: 4 }}>{String(a.summary)}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="label">Latest task</span>
            <Link href="/tasks" className="chip">All tasks</Link>
          </div>
          {!latest ? (
            <EmptyState icon="◇" title="No tasks yet" hint="Use the command box above to create one." />
          ) : (
            <Link href={`/tasks/${String(latest.taskId)}`} className="glass interactive" style={{ padding: 14, display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <b>{String(latest.goal)}</b>
                <StatusPill status={String(latest.status)} />
              </div>
              <div className="m" style={{ fontSize: 12.5, marginTop: 6 }}>{String(latest.assignedServiceId ?? 'unassigned')} · {timeAgo(String(latest.createdAt))}</div>
            </Link>
          )}
        </div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="label">Reliability snapshot</span>
            <Link href="/reliability" className="chip">Details</Link>
          </div>
          {rels.length === 0 ? (
            <EmptyState icon="✦" title="No reliability data yet" hint="Run “Analyze system history” to compute it." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rels.map((r, i) => {
                const score = Number(r.score ?? 0);
                const tone = score >= 0.75 ? 'var(--ok)' : score >= 0.5 ? 'var(--warn)' : 'var(--err)';
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>{String(r.targetId)}</span><span className="m">{score.toFixed(2)} · {String(r.trend)}</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 99, background: 'var(--glass-2)', marginTop: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(score * 100)}%`, height: '100%', background: tone, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
