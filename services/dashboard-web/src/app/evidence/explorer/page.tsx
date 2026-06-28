import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Plain-language meaning for each real evidence type. */
const PROVES: Record<string, { label: string; proves: string; by: string }> = {
  research_report: { label: 'Research', proves: 'the kernel gathered cited, reliability-scored sources', by: 'internet-research-service' },
  review_report: { label: 'Review', proves: 'a plan was independently reviewed for risk and security', by: 'reviewer-agent / architect-agent' },
  qa_report: { label: 'QA', proves: 'acceptance criteria were checked against real evidence', by: 'qa-agent' },
  intelligence_report: { label: 'Report', proves: 'an executive intelligence report was produced', by: 'report-agent' },
  validation_report: { label: 'Validation', proves: 'a capability passed a real runtime validation', by: 'builder-agent' },
  health_check_result: { label: 'Health', proves: 'a service responded to a health check', by: 'monitor-agent' },
  manifest_check_result: { label: 'Manifest', proves: 'a service exposed its manifest with the internal token', by: 'monitor-agent' },
  build_log: { label: 'Build', proves: 'code was built', by: 'builder-agent' },
  typecheck_log: { label: 'Typecheck', proves: 'code typechecked', by: 'builder-agent' },
  github_commit: { label: 'GitHub', proves: 'code was delivered to GitHub', by: 'devops-agent' },
  approval_decision: { label: 'Approval', proves: 'a human approved or rejected a sensitive action', by: 'operator' },
  diagnosis_report: { label: 'Diagnosis', proves: 'an incident was diagnosed', by: 'monitor-agent' },
  repair_plan: { label: 'Repair plan', proves: 'a repair was planned', by: 'monitor-agent' },
  repair_attempt: { label: 'Repair', proves: 'a repair was attempted', by: 'monitor-agent' },
  validation_after_repair: { label: 'Re-validation', proves: 'a service was re-validated after repair', by: 'monitor-agent' },
  activation_after_repair: { label: 'Activation', proves: 'a service was activated after repair', by: 'monitor-agent' },
  screenshot: { label: 'Screenshot', proves: 'a browser test captured a screenshot', by: 'browser-testing-agent' },
  test_report: { label: 'Test', proves: 'a browser/HTTP test ran', by: 'browser-testing-agent' },
};
const meta = (type: string) => PROVES[type] ?? { label: type.replace(/_/g, ' '), proves: 'a recorded outcome', by: 'kernel' };

export default async function EvidenceExplorerPage() {
  const rows = (await gateway.evidence()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  const byType = new Map<string, Array<Record<string, unknown>>>();
  for (const e of list) {
    const k = String(e.type);
    (byType.get(k) ?? byType.set(k, []).get(k)!).push(e);
  }
  const types = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <>
      <PageHeader title="Proof & Evidence Explorer" subtitle="Every meaningful outcome the kernel produced, grouped by what it proves. Real records only — the kernel never claims success without evidence." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✦" title="No evidence yet" hint='Run a real task — e.g. "Research current best practices and create an improvement plan" — and proof will appear here.' /></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="label" style={{ marginBottom: 8 }}>{list.length} evidence records across {types.length} kinds</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {types.map(([t, items]) => <span key={t} className="chip">{meta(t).label} · {items.length}</span>)}
            </div>
          </div>
          {types.map(([t, items]) => {
            const m = meta(t);
            return (
              <div key={t} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                  <span className="label">{m.label}</span>
                  <span className="m" style={{ fontSize: 12.5 }}>proves {m.proves} · by {m.by}</span>
                </div>
                <div className="card-grid">
                  {items.slice(0, 12).map((e, i) => (
                    <div className="card" key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                        <span style={{ fontSize: 13 }}>{String(e.summary)}</span>
                        {e.s3ObjectId ? <span className="badge ok">S3</span> : null}
                      </div>
                      <div className="m" style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {e.taskId ? <Link href={`/tasks/${String(e.taskId)}`} className="chip">task</Link> : null}
                        {e.serviceName ? <span className="chip">{String(e.serviceName)}</span> : null}
                        {e.capabilityId ? <span className="chip">{String(e.capabilityId)}</span> : null}
                        <span>{timeAgo(String(e.createdAt))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
