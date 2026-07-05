import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const items = (await gateway.meGoals() as Array<Record<string, unknown>> | null) ?? [];
  return (
    <>
      <PageHeader title="Goals" subtitle="User-scoped goals — the anchor of the personal intelligence graph." />
      <div className="card">
        {items.length === 0 ? (
          <EmptyState icon="·" title="No goals recorded" hint="Goals drive briefings and rankings. Add via POST /v1/me/goals or ingest kind=goal." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {items.map((x, i) => (
              <div key={i} className="glass" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                <span><b>{String(x.title ?? x.topic ?? '')}</b>{x.description ? <span className="m"> — {String(x.description).slice(0, 140)}</span> : null}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge">{String(x.horizon ?? '')} · {String(x.priority ?? '')}</span>
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
