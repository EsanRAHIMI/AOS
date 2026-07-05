import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Phase AA — Tenants: the isolation boundary for organizations, teams,
 *  government units and departments. Cross-tenant reads fail closed. */
export default async function TenantsPage() {
  const current = await gateway.tenantsCurrent();
  const tenant = current?.tenant ?? null;
  const members = current?.members ?? [];
  return (
    <>
      <PageHeader title="Tenants" subtitle="Tenant data is isolated: members only, roles enforced, cross-tenant access fails closed and is audited." />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <MetricCard label="Active tenant" value={String(tenant?.name ?? '—')} hint={String(tenant?.tenantId ?? '')} />
        <MetricCard label="Kind" value={String(tenant?.kind ?? '—')} hint="personal · team · company · government unit · department" />
        <MetricCard label="Members" value={members.length} />
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Memberships & roles</div>
        {members.length === 0 ? (
          <EmptyState icon="·" title="No members" hint="Memberships appear here as users join this tenant." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.map((m, i) => (
              <div key={i} className="glass" style={{ padding: 9, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                <span>{String(m.userId)}</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {(m.roles as string[] ?? []).map((r, j) => <span key={j} className={`badge ${r === 'owner' ? 'ok' : ''}`}>{r}</span>)}
                  <StatusPill status={String(m.status ?? 'active')} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
