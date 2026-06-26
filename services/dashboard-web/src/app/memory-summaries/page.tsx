import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function MemorySummariesPage() {
  const rows = (await gateway.memorySummaries()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Memory Summaries</h1>
      <p className="sub">Compressed history so future agents understand context with low token cost.</p>
      {!rows || rows.length === 0 ? (
        <div className="card"><div className="empty">No summaries yet.</div></div>
      ) : (
        rows.map((s, i) => {
          const facts = Array.isArray(s.keyFacts) ? (s.keyFacts as string[]) : [];
          const next = Array.isArray(s.nextActions) ? (s.nextActions as string[]) : [];
          return (
            <div className="card" key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b><span className="badge">{String(s.scope)}</span> {String(s.scopeId ?? '')}</b><span className="m">~{String(s.tokenBudget)} tokens · {timeAgo(String(s.createdAt))}</span></div>
              <p className="sub">{String(s.compressedText)}</p>
              {facts.length > 0 && <p className="sub" style={{ marginBottom: 4 }}>Key facts: {facts.join(' · ')}</p>}
              {next.length > 0 && <p className="sub" style={{ margin: 0 }}>Next: {next.join(' · ')}</p>}
            </div>
          );
        })
      )}
    </>
  );
}
