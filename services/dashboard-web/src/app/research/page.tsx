import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Phase AG — `mode` says whether the LLM was real; `sourceMode` says
 *  whether the cited URLs came from an actual web search this run
 *  ('search_api'), the LLM's own recall (no search configured, 'llm_only'),
 *  or hand-curated fallback text (no search AND no LLM, 'curated_fallback').
 *  Surfaced separately because a real LLM with unverified recalled URLs is
 *  a meaningfully different trust level than real search results. */
const SOURCE_MODE_LABEL: Record<string, string> = { search_api: 'live web search', llm_only: 'LLM recall', curated_fallback: 'curated fallback' };
const sourceModeTone = (m: string) => (m === 'search_api' ? 'ok' : m === 'llm_only' ? 'warn' : '');

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
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <span className={`badge ${r.mode === 'real' ? 'ok' : 'warn'}`}>{String(r.mode)}</span>
                  {r.sourceMode ? <span className={`badge ${sourceModeTone(String(r.sourceMode))}`} title="Where the cited source URLs came from">{SOURCE_MODE_LABEL[String(r.sourceMode)] ?? String(r.sourceMode)}</span> : null}
                </div>
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
