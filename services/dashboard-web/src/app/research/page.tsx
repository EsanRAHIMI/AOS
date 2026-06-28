import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  const rows = (await gateway.research()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Research" subtitle="Governed, read-only research reports with cited, reliability-scored sources from the internet-research-service." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✦" title="No research yet" hint='Run a goal like "Research current best practices for securing autonomous agent dashboards".' /></div>
      ) : (
        <div className="card-grid">
          {list.map((r, i) => (
            <Link href={`/research/${String(r.reportId)}`} key={i} className="card interactive" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>{String(r.topic)}</b>
                <span className={`badge ${r.mode === 'real' ? 'ok' : 'warn'}`}>{String(r.mode)}</span>
              </div>
              <div className="m" style={{ fontSize: 12.5 }}>{String(r.summary)}</div>
              <div className="m" style={{ fontSize: 12, marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="chip">{Array.isArray(r.findings) ? (r.findings as unknown[]).length : 0} findings</span>
                <span className="chip">{Array.isArray(r.sourceIds) ? (r.sourceIds as unknown[]).length : 0} sources</span>
                <span>{timeAgo(String(r.createdAt))}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
