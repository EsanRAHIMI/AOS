import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function TraceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = (await gateway.llmTrace(id)) as Record<string, unknown> | null;
  if (!t) return (<><h1 className="h1">LLM Trace</h1><div className="card"><div className="empty">Not found.</div></div></>);
  return (
    <>
      <h1 className="h1">LLM Trace</h1>
      <p className="sub">{String(t.agentId)} · {String(t.taskType)} · <span className={`badge ${t.usedFallback ? 'warn' : 'ok'}`}>{String(t.provider)}{t.usedFallback ? ' (fallback)' : ''}</span> · <span className={`badge ${t.valid ? 'ok' : 'err'}`}>{t.valid ? 'valid' : 'invalid'}</span></p>
      <div className="card">
        <table><tbody>
          <tr><td className="m" style={{ width: 160 }}>Model</td><td>{String(t.model)}</td></tr>
          <tr><td className="m">Prompt version</td><td>{String(t.promptVersion)}</td></tr>
          <tr><td className="m">Tokens (in/out)</td><td>{Number(t.tokensIn ?? 0)}/{Number(t.tokensOut ?? 0)}</td></tr>
          <tr><td className="m">Cost</td><td>${Number(t.costUsd ?? 0).toFixed(4)}</td></tr>
          <tr><td className="m">Task</td><td className="m">{String(t.taskId ?? '—')}</td></tr>
        </tbody></table>
        <div className="label" style={{ marginTop: 12, marginBottom: 6 }}>Prompt</div>
        <pre className="feed" style={{ background: 'var(--panel-2)', padding: 10, borderRadius: 8, overflowX: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>{String(t.prompt ?? '')}</pre>
      </div>
    </>
  );
}
