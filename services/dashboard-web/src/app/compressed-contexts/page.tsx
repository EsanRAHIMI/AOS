import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function CompressedContextsPage() {
  const rows = (await gateway.compressedContexts()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Compressed Contexts</h1>
      <p className="sub">The low-token context future agents load first instead of raw history.</p>
      {!rows || rows.length === 0 ? (
        <div className="card"><div className="empty">No compressed contexts yet.</div></div>
      ) : (
        rows.map((c, i) => {
          const facts = Array.isArray(c.keyFacts) ? (c.keyFacts as string[]) : [];
          return (
            <div className="card" key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Context {String(c.contextId)}</b><span className="m">~{String(c.tokenBudget)} tokens · {timeAgo(String(c.createdAt))}</span></div>
              <p className="sub">{String(c.compressedText)}</p>
              <ul className="sub" style={{ marginTop: 0 }}>{facts.map((f, j) => <li key={j}>{f}</li>)}</ul>
            </div>
          );
        })
      )}
    </>
  );
}
