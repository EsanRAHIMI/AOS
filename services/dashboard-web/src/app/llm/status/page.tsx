import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function LlmStatusPage() {
  const [s, integ] = await Promise.all([gateway.llmStatus(), gateway.integrations()]);
  return (
    <>
      <h1 className="h1">LLM &amp; Integration Status</h1>
      <p className="sub">Is reasoning real or deterministic fallback? Is GitHub delivery real or prepared?</p>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card"><div className="label">LLM mode</div><div className="stat" style={{ fontSize: 18 }}><span className={`badge ${s?.status.mode === 'real' ? 'ok' : 'warn'}`}>{s?.status.mode ?? 'unknown'}</span></div><div className="sub" style={{ marginTop: 6 }}>{s?.status.provider}</div></div>
        <div className="card"><div className="label">GitHub mode</div><div className="stat" style={{ fontSize: 18 }}><span className={`badge ${integ?.github.mode === 'github_api' ? 'ok' : 'warn'}`}>{integ?.github.mode ?? 'unknown'}</span></div></div>
        <div className="card"><div className="label">Real / fallback calls</div><div className="stat">{s?.realCount ?? 0}/{s?.fallbackCount ?? 0}</div></div>
        <div className="card"><div className="label">Total cost</div><div className="stat" style={{ fontSize: 18 }}>${Number(s?.totalCostUsd ?? 0).toFixed(4)}</div></div>
      </div>
      <div className="card">
        <p className="sub" style={{ margin: 0 }}>
          {s?.status.mode === 'real'
            ? `Reasoning runs on ${s.status.provider}. ${s.invalidCount} invalid outputs were rejected and never mutated state.`
            : 'No provider key configured — reasoning uses the deterministic, schema-validated fallback. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable real reasoning.'}
        </p>
      </div>
    </>
  );
}
