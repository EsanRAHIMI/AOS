import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Phase AA — Consents: every connector needs an ACTIVE grant. Read-only in
 *  this phase; revocation blocks future syncs immediately. */
export default async function ConsentsPage() {
  const consents = (await gateway.consents()) ?? [];
  const active = consents.filter((c) => c.status === 'active');
  return (
    <>
      <PageHeader title="Consents" subtitle="Connector data requires an active, revocable consent grant. Phase AA grants are READ-ONLY by design — write modes will require preview + approval + audit + evidence." />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <MetricCard label="Active grants" value={active.length} tone={active.length ? 'ok' : undefined} />
        <MetricCard label="Revoked / expired" value={consents.length - active.length} />
        <MetricCard label="Access mode" value="read_only" hint="enforced platform-wide this phase" tone="ok" />
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Grants</div>
        {consents.length === 0 ? (
          <EmptyState icon="·" title="No consent grants yet" hint="Create one via POST /v1/consents (e.g. connectorType “calendar”). Until then, personal briefings honestly report sources as not_configured." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {consents.map((c, i) => (
              <div key={i} className="glass" style={{ padding: 9, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                <span><b>{String(c.connectorType)}</b> <span className="m">· {String(c.grantId)}</span></span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge">{String(c.accessMode)}</span>
                  <StatusPill status={String(c.status)} />
                  <span className="m" style={{ fontSize: 11 }}>{String(c.grantedAt).slice(0, 10)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
