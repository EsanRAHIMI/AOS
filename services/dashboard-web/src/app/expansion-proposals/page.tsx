import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { approveExpansionAction, rejectExpansionAction, requestChangesExpansionAction } from '@/app/actions';
import { PageHeader, EmptyState } from '@/components/ui';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'approved' || s === 'generated' ? 'ok' : s === 'rejected' || s === 'failed' ? 'err' : 'warn');

export default async function ExpansionsPage() {
  const rows = (await gateway.expansionProposals()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Expansion Proposals" subtitle="Plans to grow the kernel with new services, agents, or tools. Approving builds the service." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✦" title="No expansion proposals yet" hint="Create a task that needs a missing capability and the kernel will propose one here." /></div>
      ) : (
        <div className="card-grid">
          {list.map((p, i) => {
            const id = String(p.proposalId);
            const status = String(p.status);
            const pending = status === 'waiting_approval' || status === 'changes_requested';
            return (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <b style={{ fontSize: 14.5 }}>{String(p.proposedServiceName)}</b>
                  <span className={`badge ${badgeFor(status)}`}>{status}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span className="chip">{String(p.missingCapability)}</span>
                  {p.proposedToolName ? <span className="chip">{String(p.proposedToolName)}</span> : null}
                  <span className="chip">risk: {String(p.riskLevel)}</span>
                </div>
                <div className="m" style={{ fontSize: 12, marginBottom: 12 }}>Proposed {timeAgo(String(p.createdAt))}</div>
                {pending && (
                  <div className="actions">
                    <form action={approveExpansionAction}>
                      <input type="hidden" name="id" value={id} />
                      <button className="btn btn-ok" type="submit">Approve &amp; build</button>
                    </form>
                    <form action={requestChangesExpansionAction}>
                      <input type="hidden" name="id" value={id} />
                      <button className="btn btn-ghost" type="submit">Changes</button>
                    </form>
                    <form action={rejectExpansionAction}>
                      <input type="hidden" name="id" value={id} />
                      <button className="btn btn-err" type="submit">Reject</button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
