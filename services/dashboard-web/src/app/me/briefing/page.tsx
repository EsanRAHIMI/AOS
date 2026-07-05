import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState } from '@/components/ui';
import { RunReviewButton } from '../controls';

export const dynamic = 'force-dynamic';

export default async function BriefingPage() {
  const runs = (await gateway.realityBriefings()) ?? [];
  return (
    <>
      <PageHeader title="Daily Briefings" subtitle="Built ONLY from your real scoped data. Unconnected sources are listed as not_configured — never a fake schedule." actions={<RunReviewButton type="daily" label="Run briefing now" />} />
      {runs.length === 0 ? (
        <div className="card"><EmptyState icon="·" title="No briefings yet" hint="Run one now, or tell the operator “run my daily briefing”. It will honestly list what data it used and what is missing." /></div>
      ) : runs.map((b, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="label">{String(b.date)}</div>
            <span className="m" style={{ fontSize: 11 }}>{String(b.source)} · confidence {String(b.confidence)}</span>
          </div>
          <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div><b>Priorities</b>: {(b.topPriorities as string[]).map((p, j) => `${j + 1}. ${p}`).join('  ') || 'none rankable'}</div>
            <div><b>Risks</b>: {(b.risks as string[]).join('; ') || 'none recorded'}</div>
            <div><b>Income</b>: {String(b.incomeAction)}</div>
            <div><b>Growth</b>: {String(b.growthAction)}</div>
            <div><b>AOS</b>: {String(b.aosAction)}</div>
            <div className="m">Approvals pending: {String(b.pendingApprovals)} · Missing: {(b.missingData as string[]).slice(0, 3).join('; ') || 'none'}</div>
            <div className="m" style={{ fontSize: 11 }}>Sources used: {(b.sourcesUsed as string[]).join(', ')} · Not configured: {(b.sourcesNotConfigured as string[]).join(', ') || 'none'}</div>
          </div>
        </div>
      ))}
    </>
  );
}
