import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function LlmTracesPage() {
  const rows = (await gateway.llmTraces(100)) as Array<Record<string, unknown>> | null;
  const totalCost = (rows ?? []).reduce((a, r) => a + Number(r.costUsd ?? 0), 0);
  return (
    <>
      <h1 className="h1">LLM Traces</h1>
      <p className="sub">Every reasoning call: provider, validation, tokens and cost. Total ~${totalCost.toFixed(4)}.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No LLM traces yet.</div>
        ) : (
          <table>
            <thead><tr><th>Agent</th><th>Task type</th><th>Provider</th><th>Validated</th><th>Tokens</th><th>Cost</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={i}>
                  <td className="m">{String(t.agentId)}</td>
                  <td className="m">{String(t.taskType)}</td>
                  <td><span className="badge">{String(t.provider)}{t.usedFallback ? ' (fallback)' : ''}</span></td>
                  <td><span className={`badge ${t.valid ? 'ok' : 'err'}`}>{t.valid ? 'valid' : 'invalid'}</span></td>
                  <td className="m">{Number(t.tokensIn ?? 0)}/{Number(t.tokensOut ?? 0)}</td>
                  <td className="m">${Number(t.costUsd ?? 0).toFixed(4)}</td>
                  <td className="m">{timeAgo(String(t.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
