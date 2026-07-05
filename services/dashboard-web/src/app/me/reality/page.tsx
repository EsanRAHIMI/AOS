import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function RealityPage() {
  const [reality, risks] = await Promise.all([gateway.realityProfile(), gateway.realityRisks()]);
  const p = reality?.profile ?? null;
  const graph = reality?.graph;
  return (
    <>
      <PageHeader title="Personal Reality" subtitle="Who you are, what you own, what you are building — as recorded, with source and freshness. Nothing here is inferred without being labeled." />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Graph nodes" value={graph?.nodes.length ?? 0} hint="user · goals · projects · assets · systems · risks · opportunities" />
        <MetricCard label="Graph edges" value={graph?.edges.length ?? 0} hint="pursues · builds · owns · serves · threatens" />
        <MetricCard label="Missing data" value={graph?.missingData.length ?? 0} tone={graph?.missingData.length ? 'warn' : 'ok'} />
        <MetricCard label="Freshness" value={graph?.dataFreshness?.slice(0, 10) ?? '—'} />
      </div>
      <div className="grid cols-2" style={{ gap: 16 }}>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Reality profile</div>
          {p ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <div><b>{String(p.displayName || 'Unnamed')}</b> — {String(p.headline || 'no headline yet')}</div>
              {p.summary ? <div className="m" style={{ fontSize: 12.5 }}>{String(p.summary)}</div> : null}
              <div className="m" style={{ fontSize: 12 }}>Position: {String(p.currentPosition || '—')} · Location: {String(p.location || '—')}</div>
              <div className="m" style={{ fontSize: 12 }}>Income direction: {String(p.incomeDirection || 'not set')}</div>
              <div className="m" style={{ fontSize: 12 }}>Learning direction: {String(p.learningDirection || 'not set')}</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{(p.focusAreas as string[] ?? []).map((f, i) => <span key={i} className="chip">{f}</span>)}</div>
              <div className="m" style={{ fontSize: 10.5 }}>source: {String(p.source)} · confidence {String(p.confidence)} · fresh {String(p.freshness).slice(0, 10)}</div>
            </div>
          ) : <EmptyState icon="·" title="No reality profile yet" hint="Ingest it: POST /v1/me/reality/ingest kind=profile (displayName, headline, summary, focusAreas, incomeDirection…) — or tell the operator “build my personal reality baseline”." />}
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Risks & blockers ({(risks ?? []).length})</div>
          {(risks ?? []).length === 0 ? <EmptyState icon="·" title="No risks recorded" hint="Ingest kind=risk with title/severity/mitigation — risk mitigation ranks at the top of next actions." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(risks ?? []).map((r, i) => (
                <div key={i} className="glass" style={{ padding: 9, fontSize: 12.5, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{String(r.title)}{r.mitigation ? <span className="m"> — plan: {String(r.mitigation).slice(0, 80)}</span> : null}</span>
                  <span className={`badge ${['high', 'critical'].includes(String(r.severity)) ? 'err' : 'warn'}`}>{String(r.severity)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
