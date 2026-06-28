import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const rows = (await gateway.reports()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Intelligence Reports" subtitle="Executive/system reports from the report-agent, grounded in research, plans, reviews, QA, costs and system state." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✦" title="No reports yet" hint="The report-agent writes a report at the end of an intelligence task." /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {list.map((r, i) => {
            const sections = (r.sections as Array<Record<string, unknown>>) ?? [];
            return (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                  <b style={{ fontSize: 14.5 }}>{String(r.title)}</b>
                  <span className={`badge ${r.mode === 'real' ? 'ok' : 'warn'}`}>{String(r.mode)}</span>
                </div>
                <div className="m" style={{ fontSize: 13, marginBottom: 8 }}>{String(r.headline)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sections.map((s, j) => (
                    <div key={j} className="glass" style={{ padding: 10 }}>
                      <div className="label" style={{ marginBottom: 4 }}>{String(s.heading)}</div>
                      <div style={{ fontSize: 12.5 }}>{String(s.body)}</div>
                    </div>
                  ))}
                </div>
                <div className="m" style={{ fontSize: 12, marginTop: 8 }}>{timeAgo(String(r.createdAt))}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
