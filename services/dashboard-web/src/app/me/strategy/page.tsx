import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState } from '@/components/ui';
import { RunReviewButton } from '../controls';

export const dynamic = 'force-dynamic';

export default async function StrategyPage() {
  const runs = (await gateway.realityStrategies()) ?? [];
  return (
    <>
      <PageHeader title="Weekly Strategy" subtitle="Goals vs actions vs opportunities → ranked plan, what AOS should build, what you should do, what needs approval." actions={<RunReviewButton type="weekly" label="Run weekly review" />} />
      {runs.length === 0 ? (
        <div className="card"><EmptyState icon="·" title="No strategy reviews yet" hint="Run one now — it compares your recorded goals, decided actions and open opportunities. Nothing is invented." /></div>
      ) : runs.map((s, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div className="label" style={{ marginBottom: 8 }}>Week of {String(s.weekOf)} — {String(s.goalsReviewed)} goals · {String(s.completedActions)} done · {String(s.missedActions)} missed · {String(s.newOpportunities)} new opportunities</div>
          <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div><b>Plan</b>:</div>
            {(s.weeklyPlan as string[]).map((p, j) => <div key={j} className="m" style={{ fontSize: 12 }}>{p}</div>)}
            <div><b>AOS should build</b>: {(s.aosShouldBuild as string[]).join('; ')}</div>
            <div><b>You should do</b>: {(s.esanShouldDo as string[]).join('; ') || '—'}</div>
            {(s.needsApproval as string[]).length > 0 && <div style={{ color: 'var(--warn)' }}><b>Needs approval</b>: {(s.needsApproval as string[]).join('; ')}</div>}
          </div>
        </div>
      ))}
    </>
  );
}
