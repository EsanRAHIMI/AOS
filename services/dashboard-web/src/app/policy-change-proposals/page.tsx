import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { decidePolicyProposalAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

export default async function PolicyProposalsPage() {
  const rows = (await gateway.policyProposals()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Policy Change Proposals</h1>
      <p className="sub">Proposed configurable policy rules. Approving activates the rule (audit-logged).</p>
      {!rows || rows.length === 0 ? (
        <div className="card"><div className="empty">No policy change proposals yet.</div></div>
      ) : (
        rows.map((p, i) => {
          const id = String(p.proposalId);
          const status = String(p.status);
          const rule = (p.rule ?? {}) as Record<string, unknown>;
          const pending = status === 'waiting_approval' || status === 'changes_requested';
          return (
            <div className="card" key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{String(rule.action)} → {String(rule.decision)}</b><span className="badge warn">{status}</span></div>
              <p className="sub">{String(p.reason)} · {timeAgo(String(p.createdAt))}</p>
              {pending && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {['approve', 'reject'].map((a) => (
                    <form key={a} action={decidePolicyProposalAction}>
                      <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={a} />
                      <button className={a === 'approve' ? 'btn-ok' : 'btn-err'} type="submit">{a}</button>
                    </form>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
