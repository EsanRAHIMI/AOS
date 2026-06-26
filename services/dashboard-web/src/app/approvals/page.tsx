import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { approveAction, rejectAction } from '@/app/actions';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

function riskTone(r: string): 'ok' | 'warn' | 'err' {
  const v = r.toLowerCase();
  if (/(critical|high)/.test(v)) return 'err';
  if (/(low|info)/.test(v)) return 'ok';
  return 'warn';
}

export default async function ApprovalsPage() {
  const rows = (await gateway.approvals()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Approvals" subtitle="Sensitive actions are paused here until you decide. Every decision is logged to the audit trail." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✓" title="Nothing awaiting you" hint="When an agent proposes a sensitive or irreversible action, it will appear here for approval." /></div>
      ) : (
        <div className="card-grid">
          {list.map((a, i) => {
            const id = String(a.approvalId);
            const risk = String(a.riskLevel ?? 'medium');
            const tone = riskTone(risk);
            return (
              <div className="card" key={i} style={{ borderColor: tone === 'err' ? 'rgba(255,107,129,0.35)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <b style={{ fontSize: 14.5 }}>{String(a.actionType)}</b>
                  <span className={`badge ${tone}`}>{risk} risk</span>
                </div>
                <p className="m" style={{ fontSize: 13, margin: '0 0 6px' }}>{String(a.summary)}</p>
                <div className="m" style={{ fontSize: 12, marginBottom: 12 }}>Requested {timeAgo(String(a.createdAt))}</div>
                <div className="actions">
                  <form action={approveAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={id} />
                    <button className="btn btn-ok" type="submit">Approve</button>
                  </form>
                  <form action={rejectAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={id} />
                    <button className="btn btn-err" type="submit">Reject</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
