import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function DecisionMemoryPage() {
  const rows = (await gateway.decisionMemory()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Decision Memory</h1>
      <p className="sub">What options existed, which was chosen, why, the outcome, and lessons.</p>
      {!rows || rows.length === 0 ? (
        <div className="card"><div className="empty">No decisions recorded yet.</div></div>
      ) : (
        rows.map((d, i) => {
          const alts = Array.isArray(d.alternatives) ? (d.alternatives as Array<{ label: string; reason: string }>) : [];
          const lessons = Array.isArray(d.lessons) ? (d.lessons as string[]) : [];
          return (
            <div className="card" key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{String(d.goal)}</b><span className="m">{timeAgo(String(d.createdAt))}</span>
              </div>
              <p className="sub" style={{ marginBottom: 6 }}>Selected <Link href={`/strategic-plans/${String(d.selectedPlanId)}`}>{String(d.selectedPlanId)}</Link> — {String(d.selectedReason)}</p>
              <p className="sub" style={{ marginBottom: 6 }}>Outcome: <b>{String(d.outcome)}</b></p>
              {alts.length > 0 && <p className="sub" style={{ marginBottom: 6 }}>Rejected: {alts.map((a) => `${a.label} (${a.reason})`).join(' · ')}</p>}
              {lessons.length > 0 && <p className="sub" style={{ margin: 0 }}>Lessons: {lessons.join(' · ')}</p>}
            </div>
          );
        })
      )}
    </>
  );
}
