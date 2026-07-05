import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const items = (await gateway.realityOpportunities()) ?? [];
  return (
    <>
      <PageHeader title="Opportunity Radar" subtitle="Scored against your goals and assets. Every entry shows source, confidence and freshness — no fake market claims." />
      <div className="card">
        {items.length === 0 ? (
          <EmptyState icon="·" title="No opportunities recorded" hint="The research provider is not_configured, so nothing is invented. Ingest income/career ideas or record aos_capability gaps." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {items.map((x, i) => (
              <div key={i} className="glass" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                <span><b>{String(x.title ?? x.topic ?? '')}</b>{x.description ? <span className="m"> — {String(x.description).slice(0, 140)}</span> : null}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge ok">value {String(x.valueScore ?? '')}</span><span className="badge">{String(x.category ?? '')}</span><span className="m" style={{ fontSize: 10.5 }}>i{String(x.impactScore)}/e{String(x.effortScore)}/r{String(x.riskScore)} · conf {String(x.confidence)}</span>
                  <StatusPill status={String(x.status ?? 'active')} />
                  <span className="m" style={{ fontSize: 10.5 }}>{String(x.source ?? '')} · {String(x.freshness ?? '').slice(0, 10)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
