import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { approveExpansionAction, rejectExpansionAction, requestChangesExpansionAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'approved' || s === 'generated' ? 'ok' : s === 'rejected' || s === 'failed' ? 'err' : 'warn');

export default async function ExpansionsPage() {
  const rows = (await gateway.expansionProposals()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Expansion Proposals</h1>
      <p className="sub">Plans to grow the kernel with new services/agents/tools. Approving builds the service.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No expansion proposals yet. Create a task that needs a missing capability.</div>
        ) : (
          <table>
            <thead><tr><th>Proposed service</th><th>Capability</th><th>Tool</th><th>Risk</th><th>Status</th><th>When</th><th></th></tr></thead>
            <tbody>
              {rows.map((p, i) => {
                const id = String(p.proposalId);
                const status = String(p.status);
                const pending = status === 'waiting_approval' || status === 'changes_requested';
                return (
                  <tr key={i}>
                    <td>{String(p.proposedServiceName)}</td>
                    <td><span className="badge warn">{String(p.missingCapability)}</span></td>
                    <td className="m">{String(p.proposedToolName ?? '—')}</td>
                    <td className="m">{String(p.riskLevel)}</td>
                    <td><span className={`badge ${badgeFor(status)}`}>{status}</span></td>
                    <td className="m">{timeAgo(String(p.createdAt))}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {pending && (
                        <>
                          <form action={approveExpansionAction} style={{ display: 'inline' }}>
                            <input type="hidden" name="id" value={id} />
                            <button className="btn-ok" type="submit">Approve &amp; build</button>
                          </form>{' '}
                          <form action={requestChangesExpansionAction} style={{ display: 'inline' }}>
                            <input type="hidden" name="id" value={id} />
                            <button className="btn-err" type="submit">Changes</button>
                          </form>{' '}
                          <form action={rejectExpansionAction} style={{ display: 'inline' }}>
                            <input type="hidden" name="id" value={id} />
                            <button className="btn-err" type="submit">Reject</button>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
