import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function QaPage() {
  const rows = (await gateway.qa()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="QA" subtitle="qa-agent acceptance checks: criteria derived from the goal and verified against produced evidence. QA does not rubber-stamp." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="◇" title="No QA reports yet" hint="QA runs after a task produces evidence." /></div>
      ) : (
        <div className="card-grid">
          {list.map((q, i) => {
            const criteria = (q.criteria as Array<Record<string, unknown>>) ?? [];
            const met = criteria.filter((c) => c.met).length;
            return (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                  <b style={{ fontSize: 14, lineHeight: 1.3 }}>{String(q.goal)}</b>
                  <span className={`badge ${q.passed ? 'ok' : 'err'}`}>{q.passed ? 'passed' : 'failed'}</span>
                </div>
                <div className="m" style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span className="chip">{String(q.mode)}</span>
                  <span className="chip">{met}/{criteria.length} criteria</span>
                  <span>{timeAgo(String(q.createdAt))}</span>
                </div>
                <div className="m" style={{ fontSize: 12.5, marginBottom: 8 }}>{String(q.verdict)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {criteria.map((c, j) => (
                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                      <span>{String(c.criterion)}</span>
                      <span className={`badge ${c.met ? 'ok' : 'err'}`}>{c.met ? 'met' : 'gap'}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
