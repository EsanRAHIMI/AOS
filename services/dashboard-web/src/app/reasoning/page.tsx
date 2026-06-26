import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function ReasoningPage() {
  const [decisions, plans] = await Promise.all([gateway.decisionMemory(), gateway.strategicPlans()]);
  const decs = (decisions ?? []) as Array<Record<string, unknown>>;
  const pl = (plans ?? []) as Array<Record<string, unknown>>;
  return (
    <>
      <h1 className="h1">Reasoning</h1>
      <p className="sub">How the kernel chose between strategies — options, scores, policy, and the decision.</p>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card"><div className="label">Decisions</div><div className="stat">{decs.length}</div></div>
        <div className="card"><div className="label">Candidate plans</div><div className="stat">{pl.length}</div></div>
        <div className="card"><div className="label">Selected plans</div><div className="stat">{pl.filter((p) => p.selected).length}</div></div>
        <div className="card"><div className="label">Latest</div><div className="stat" style={{ fontSize: 15 }}>{decs[0] ? timeAgo(String(decs[0].createdAt)) : '—'}</div></div>
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Recent decisions</div>
        {decs.length === 0 ? <div className="empty">No decisions yet. Try "Improve the reliability of browser-testing-agent".</div> : (
          <table>
            <thead><tr><th>Goal</th><th>Selected plan</th><th>Why</th><th>Task</th><th>When</th></tr></thead>
            <tbody>
              {decs.map((d, i) => (
                <tr key={i}>
                  <td className="m">{String(d.goal)}</td>
                  <td><Link href={`/strategic-plans/${String(d.selectedPlanId)}`}>{String(d.selectedPlanId)}</Link></td>
                  <td className="m">{String(d.selectedReason)}</td>
                  <td className="m"><Link href={`/tasks/${String(d.taskId)}`}>{String(d.taskId)}</Link></td>
                  <td className="m">{timeAgo(String(d.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
