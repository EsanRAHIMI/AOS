import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const data = await gateway.realityProjects();
  const projects = data?.projects ?? [];
  const assets = data?.assets ?? [];
  return (
    <>
      <PageHeader title="Projects & Assets" subtitle="What you are building and what you own — linked to goals and income potential." />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <MetricCard label="Projects" value={projects.length} />
        <MetricCard label="Assets" value={assets.length} hint="skills · software · content · audience · infrastructure" />
        <MetricCard label="High income potential" value={projects.filter((p) => p.incomePotential === 'high').length} tone="ok" />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Projects</div>
        {projects.length === 0 ? <EmptyState icon="·" title="No projects recorded" hint="Ingest kind=project (title, description, incomePotential, linkedGoalIds). GitHub import arrives with connectors (not_configured)." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {projects.map((p, i) => (
              <div key={i} className="glass" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                <span><b>{String(p.title)}</b>{p.description ? <span className="m"> — {String(p.description).slice(0, 120)}</span> : null}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`badge ${p.incomePotential === 'high' ? 'ok' : ''}`}>income: {String(p.incomePotential)}</span>
                  <span className="badge">{(p.linkedGoalIds as string[] ?? []).length} goal link(s)</span>
                  <StatusPill status={String(p.status)} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Assets</div>
        {assets.length === 0 ? <EmptyState icon="·" title="No assets recorded" hint="Ingest kind=asset — skills count as assets and power resume + opportunity linkage." /> : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {assets.map((a, i) => <span key={i} className="chip" title={String(a.description ?? '')}>{String(a.title)} · {String(a.assetType)}</span>)}
          </div>
        )}
      </div>
    </>
  );
}
