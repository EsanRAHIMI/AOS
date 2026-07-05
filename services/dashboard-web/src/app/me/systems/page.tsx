import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const items = ((await gateway.realityProjects())?.systems as Array<Record<string, unknown>> | null) ?? [];
  return (
    <>
      <PageHeader title="Systems" subtitle="What runs for you today — the leverage inventory." />
      <div className="card">
        {items.length === 0 ? (
          <EmptyState icon="·" title="No systems recorded" hint="Systems are things that run for you (software, automations, habits, AOS services). Ingest kind=system." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {items.map((x, i) => (
              <div key={i} className="glass" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                <span><b>{String(x.title ?? x.topic ?? '')}</b>{x.description ? <span className="m"> — {String(x.description).slice(0, 140)}</span> : null}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge">{String(x.systemType ?? '')}</span>
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
