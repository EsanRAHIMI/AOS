import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const rows = (await gateway.reviews()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Reviews" subtitle="Independent reviewer-agent reports on plans, architecture, security and policy. The reviewer is allowed to fail an output." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="◇" title="No reviews yet" hint="Reviews appear when the kernel produces a plan to review." /></div>
      ) : (
        <div className="card-grid">
          {list.map((r, i) => {
            const issues = (r.issues as Array<Record<string, unknown>>) ?? [];
            return (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                  <b style={{ fontSize: 14 }}>{String(r.target)}</b>
                  <span className={`badge ${r.passed ? 'ok' : 'err'}`}>{r.passed ? 'passed' : 'failed'}</span>
                </div>
                <div className="m" style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span className="chip">{String(r.mode)}</span>
                  <span className="chip">{issues.length} issues</span>
                  <span>{timeAgo(String(r.createdAt))}</span>
                </div>
                {issues.length > 0 && (
                  <ul className="sub" style={{ marginTop: 0, paddingLeft: 18 }}>
                    {issues.slice(0, 4).map((is, j) => <li key={j}><b>{String(is.severity)}</b> · {String(is.area)}: {String(is.detail)}</li>)}
                  </ul>
                )}
                {(r.requiredFixes as string[] ?? []).length > 0 && <div className="m" style={{ fontSize: 12.5 }}><b>Fixes:</b> {(r.requiredFixes as string[]).join('; ')}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
