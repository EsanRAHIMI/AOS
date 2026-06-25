import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { approveAction, rejectAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const rows = (await gateway.approvals()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Approvals</h1>
      <p className="sub">Sensitive actions waiting for your decision. Every decision is logged.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No pending approvals.</div>
        ) : (
          <table>
            <thead><tr><th>Action</th><th>Summary</th><th>Risk</th><th>Requested</th><th></th></tr></thead>
            <tbody>
              {rows.map((a, i) => {
                const id = String(a.approvalId);
                return (
                  <tr key={i}>
                    <td>{String(a.actionType)}</td>
                    <td className="m">{String(a.summary)}</td>
                    <td><span className="badge warn">{String(a.riskLevel ?? 'medium')}</span></td>
                    <td className="m">{timeAgo(String(a.createdAt))}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <form action={approveAction} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={id} />
                        <button className="btn-ok" type="submit">Approve</button>
                      </form>{' '}
                      <form action={rejectAction} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={id} />
                        <button className="btn-err" type="submit">Reject</button>
                      </form>
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
