import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Phase AA — Access log: every denied or approval-required scoped access is
 *  recorded here. Silence is not an option for the authorization engine. */
export default async function AccessLogPage() {
  const decisions = (await gateway.accessDecisions()) ?? [];
  const denied = decisions.filter((d) => d.decision === 'denied');
  const approvals = decisions.filter((d) => d.decision === 'approval_required');
  return (
    <>
      <PageHeader title="Access log" subtitle="Scoped access decisions from the central authorization engine. Missing scope fails closed; denials and approval-required decisions are always recorded." />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <MetricCard label="Recorded decisions" value={decisions.length} />
        <MetricCard label="Denied" value={denied.length} tone={denied.length ? 'warn' : 'ok'} />
        <MetricCard label="Approval required" value={approvals.length} />
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Recent decisions</div>
        {decisions.length === 0 ? (
          <EmptyState icon="·" title="No access decisions recorded yet" hint="Denials, approval-required decisions, and audited scoped accesses will appear here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {decisions.slice(0, 50).map((d, i) => (
              <div key={i} className="glass" style={{ padding: 8, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
                <span>
                  <span className={`badge ${d.decision === 'denied' ? 'err' : d.decision === 'approval_required' ? 'warn' : 'ok'}`}>{String(d.decision).replace(/_/g, ' ')}</span>
                  &nbsp;{String(d.actorId)} → {String(d.action)} {String(d.resource)} <span className="m">({String(d.scope)})</span>
                </span>
                <span className="m" style={{ fontSize: 11, maxWidth: 380, textAlign: 'right' }}>{String(d.reason).slice(0, 110)} · {String(d.createdAt).slice(11, 19)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
