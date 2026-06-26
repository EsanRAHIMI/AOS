import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badge = (s: string) => (s === 'completed' ? 'ok' : s === 'failed' || s === 'cancelled' ? 'err' : 'warn');

export default async function WorkflowsPage() {
  const rows = (await gateway.improvementWorkflows()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Improvement Workflows</h1>
      <p className="sub">Approved recommendations converted into structured, evidence-backed workflows.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No workflows yet. Approve a recommendation to create one.</div>
        ) : (
          <table>
            <thead><tr><th>Workflow</th><th>Type</th><th>Status</th><th>Steps</th><th>Impact</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((w, i) => {
                const steps = Array.isArray(w.steps) ? (w.steps as Array<{ status: string }>) : [];
                const done = steps.filter((s) => s.status === 'done').length;
                return (
                  <tr key={i}>
                    <td><Link href={`/improvement-workflows/${String(w.workflowId)}`}>{String(w.title)}</Link></td>
                    <td><span className="badge">{String(w.type)}</span></td>
                    <td><span className={`badge ${badge(String(w.status))}`}>{String(w.status)}</span></td>
                    <td className="m">{done}/{steps.length}</td>
                    <td className="m">{String(w.result || '—')}</td>
                    <td className="m">{timeAgo(String(w.createdAt))}</td>
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
