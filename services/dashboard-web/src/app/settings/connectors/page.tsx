import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Phase AA — Connectors: foundation only. Accounts hold provider METADATA and
 *  a consent reference — never secrets. Syncs are blocked without active
 *  consent and honestly report not_configured until provider phases land. */
export default async function ConnectorsPage() {
  const connectors = (await gateway.connectors()) ?? [];
  return (
    <>
      <PageHeader title="Connectors" subtitle="Read-only, consent-based foundation. No provider writes exist in this phase; no secrets are stored in the kernel database." actions={<Link href="/settings/consents" className="btn btn-ghost">Manage consents</Link>} />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <MetricCard label="Accounts" value={connectors.length} />
        <MetricCard label="Blocked (consent revoked)" value={connectors.filter((c) => c.status === 'blocked').length} tone={connectors.some((c) => c.status === 'blocked') ? 'warn' : undefined} />
        <MetricCard label="Write actions" value="none" hint="by design in Phase AA" tone="ok" />
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Accounts</div>
        {connectors.length === 0 ? (
          <EmptyState icon="·" title="No connector accounts" hint="Create a consent grant first, then register the account against it. Real provider sync arrives in the connector phase." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {connectors.map((c, i) => (
              <div key={i} className="glass" style={{ padding: 9, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                <span><b>{String(c.connectorType)}</b> <span className="m">· {String(c.provider || 'provider tbd')}</span></span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="m" style={{ fontSize: 11 }}>consent {String(c.consentGrantId).slice(0, 18)}</span>
                  <StatusPill status={String(c.status)} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
