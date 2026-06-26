import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function LearningPage() {
  const [runs, recs, patterns, ctxs] = await Promise.all([gateway.learningRuns(), gateway.systemRecommendations(), gateway.patterns(), gateway.compressedContexts()]);
  const lr = (runs ?? []) as Array<Record<string, unknown>>;
  const latest = lr[0];
  const ctx = ((ctxs ?? []) as Array<Record<string, unknown>>)[0];
  const keyFacts = ctx && Array.isArray(ctx.keyFacts) ? (ctx.keyFacts as string[]) : [];
  return (
    <>
      <h1 className="h1">Operational Learning</h1>
      <p className="sub">What the kernel learned from its whole history — reliability, patterns, and recommendations.</p>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card"><div className="label">Learning runs</div><div className="stat">{lr.length}</div></div>
        <div className="card"><div className="label">Records analyzed</div><div className="stat">{String(latest?.recordsAnalyzed ?? 0)}</div></div>
        <div className="card"><div className="label">Patterns</div><div className="stat">{(patterns ?? []).length}</div></div>
        <div className="card"><div className="label">Recommendations</div><div className="stat">{(recs ?? []).length}</div></div>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Compressed context (what future agents load first)</div>
          {keyFacts.length === 0 ? <div className="empty">Run "Analyze system history and recommend improvements".</div> : (
            <ul className="sub" style={{ marginTop: 0 }}>{keyFacts.map((f, i) => <li key={i}>{f}</li>)}</ul>
          )}
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Areas</div>
          <p className="sub" style={{ margin: 0 }}>
            <Link href="/learning-runs">Learning runs</Link> · <Link href="/reliability">Reliability</Link> · <Link href="/patterns">Patterns</Link> ·{' '}
            <Link href="/system-recommendations">Recommendations</Link> · <Link href="/memory-summaries">Memory summaries</Link> ·{' '}
            <Link href="/prompt-performance">Prompt performance</Link>
          </p>
          {latest && <p className="sub" style={{ marginTop: 10 }}>Latest: {String(latest.summary)} · {timeAgo(String(latest.createdAt))}</p>}
        </div>
      </div>
    </>
  );
}
