import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Resume intelligence — STRICT separation of verified facts, your claims,
 *  model inferences and suggestions. Credentials are never invented. */
export default async function ResumePage() {
  const data = await gateway.realityResume();
  const r = data?.resume ?? null;
  const careers = data?.careerRecords ?? [];
  const bucket = (label: string, items: string[], tone: string, hint: string) => (
    <div className="card">
      <div className="label" style={{ marginBottom: 8 }}>{label} ({items.length})</div>
      {items.length === 0 ? <div className="m" style={{ fontSize: 12 }}>{hint}</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
          {items.map((x, i) => <div key={i}><span className={`badge ${tone}`} style={{ marginRight: 6 }}>{label.split(' ')[0]?.toLowerCase()}</span>{x}</div>)}
        </div>
      )}
    </div>
  );
  return (
    <>
      <PageHeader title="Resume & Positioning" subtitle="Analysis uses ONLY your provided data. Facts, claims, inferences and suggestions are kept in separate buckets — nothing is invented." />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <MetricCard label="Career records" value={careers.length} hint="experience · education · achievements · certifications" />
        <MetricCard label="Skills listed" value={(r?.skills as string[] ?? []).length} />
        <MetricCard label="Positioning" value={r?.positioning ? 'set' : '—'} hint={String(r?.positioning ?? 'ingest resume data first').slice(0, 60)} />
      </div>
      {!r && careers.length === 0 ? (
        <div className="card"><EmptyState icon="·" title="No resume data in your scope" hint="Ingest kind=resume (rawText, skills) and kind=career_record entries, then ask the operator: “analyze my resume”. LinkedIn/Drive import: not_configured (consent + connector phase)." /></div>
      ) : (
        <div className="grid cols-2" style={{ gap: 16 }}>
          {bucket('Verified facts', (r?.verifiedFacts as string[]) ?? [], 'ok', 'Nothing verified yet — verification requires connectors (GitHub/LinkedIn), which are not_configured.')}
          {bucket('Your claims', (r?.userClaims as string[]) ?? [], '', 'Claims come from your ingested career records and skills.')}
          {bucket('Model inferences', (r?.modelInferences as string[]) ?? [], 'warn', 'Inferences appear after running “analyze my resume” — always labeled with confidence.')}
          {bucket('Suggestions', (r?.suggestions as string[]) ?? [], 'warn', 'Run “analyze my resume” for concrete improvements.')}
        </div>
      )}
    </>
  );
}
