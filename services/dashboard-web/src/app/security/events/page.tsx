import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

const tone = (e: Record<string, unknown>) => (e.result === 'denied' || e.result === 'failure' ? 'err' : e.riskLevel === 'high' || e.riskLevel === 'critical' ? 'warn' : '');

export default async function SecurityEventsPage() {
  const rows = (await gateway.securityEvents(200)) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Security Events" subtitle="Logins, logouts, RBAC denials, auth failures, rate-limit hits, and safe-mode changes." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✓" title="No security events yet" hint="Sign in, get denied, or run a security check to populate this trail." /></div>
      ) : (
        <div className="card-grid">
          {list.map((e, i) => (
            <div className="card" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <b style={{ fontSize: 13.5 }}>{String(e.eventType)}</b>
                <span className={`badge ${e.result === 'denied' || e.result === 'failure' ? 'err' : e.result === 'success' ? 'ok' : 'warn'}`}>{String(e.result)}</span>
              </div>
              <div className="m" style={{ fontSize: 12.5 }}>{String(e.detail || '—')}</div>
              <div className="m" style={{ fontSize: 12, marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="chip">{String(e.actorId)}{e.role ? ` · ${e.role}` : ''}</span>
                {e.target ? <span className="chip">{String(e.target)}</span> : null}
                <span className={`badge ${tone(e) || ''}`}>{String(e.riskLevel)}</span>
                <span>{timeAgo(String(e.createdAt))}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
