import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

const tone = (r: string) => (r === 'high' ? 'ok' : r === 'low' ? 'err' : 'warn');

export default async function ResearchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await gateway.researchDetail(id);
  if (!data?.report) {
    return (<><PageHeader title="Research" crumbs={[['/research', 'Research'], [`/research/${id}`, id]]} /><div className="card"><EmptyState icon="✦" title="Report not found" /></div></>);
  }
  const r = data.report as Record<string, unknown>;
  const sources = data.sources ?? [];
  return (
    <>
      <PageHeader
        title={String(r.topic)}
        subtitle={String(r.summary)}
        crumbs={[['/research', 'Research'], [`/research/${id}`, 'report']]}
        actions={<span className={`badge ${r.mode === 'real' ? 'ok' : 'warn'}`}>{String(r.mode)}</span>}
      />
      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Findings</div>
          <ul className="sub" style={{ marginTop: 0, paddingLeft: 18 }}>{(r.findings as string[] ?? []).map((f, i) => <li key={i}>{f}</li>)}</ul>
          {(r.recommendations as string[] ?? []).length > 0 && (<>
            <div className="label" style={{ margin: '12px 0 8px' }}>Recommendations</div>
            <ul className="sub" style={{ marginTop: 0, paddingLeft: 18 }}>{(r.recommendations as string[]).map((f, i) => <li key={i}>{f}</li>)}</ul>
          </>)}
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Sources ({sources.length})</div>
          {sources.length === 0 ? <EmptyState icon="◌" title="No sources" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sources.map((s, i) => (
                <div className="glass" key={i} style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <b style={{ fontSize: 13 }}>{String(s.title)}</b>
                    <span className={`badge ${tone(String(s.reliability))}`}>{String(s.reliability)}</span>
                  </div>
                  <div className="m" style={{ fontSize: 12, marginTop: 4, wordBreak: 'break-all' }}>{String(s.url)} · {String(s.publisher)} {s.publishedAt ? `· ${s.publishedAt}` : ''}</div>
                  {s.excerpt ? <div className="m" style={{ fontSize: 12.5, marginTop: 4 }}>{String(s.excerpt)}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
