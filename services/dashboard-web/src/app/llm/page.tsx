import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function LlmPage() {
  const costs = await gateway.llmCosts();
  const status = costs?.status;
  const real = status?.mode === 'real';
  const t = costs?.totals;
  return (
    <>
      <PageHeader title="Real Intelligence" subtitle="Provider status, fallback visibility, and cost — the kernel reasons through real LLMs when configured, deterministic fallback otherwise." />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Provider" value={<span style={{ fontSize: 18 }}>{status?.provider ?? '—'}</span>} tone={real ? 'ok' : 'warn'} hint={real ? 'real provider configured' : 'deterministic fallback'} />
        <MetricCard label="Mode" value={real ? 'real' : 'fallback'} tone={real ? 'ok' : 'warn'} hint="how reasoning runs now" />
        <MetricCard label="Cost today" value={`$${(t?.today ?? 0).toFixed(4)}`} hint={`${t?.calls ?? 0} calls all-time`} />
        <MetricCard label="Real / fallback calls" value={`${t?.realCount ?? 0} / ${t?.fallbackCount ?? 0}`} tone={(t?.realCount ?? 0) > 0 ? 'ok' : undefined} hint="provider vs deterministic" />
      </div>

      {!real && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(255,193,77,0.35)' }}>
          <b style={{ color: 'var(--warn)' }}>Deterministic fallback active.</b>
          <span className="m" style={{ fontSize: 13 }}> No provider key is configured. Set <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> to enable real reasoning. Keys never reach the browser.</span>
        </div>
      )}

      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Intelligence areas</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/llm/costs" className="chip">Costs &amp; budget</Link>
          <Link href="/llm/prompts" className="chip">Agent prompts</Link>
          <Link href="/llm-traces" className="chip">LLM traces</Link>
          <Link href="/research" className="chip">Research</Link>
          <Link href="/reviews" className="chip">Reviews</Link>
          <Link href="/qa" className="chip">QA</Link>
          <Link href="/reports" className="chip">Reports</Link>
        </div>
        {!costs && <EmptyState icon="✦" title="Gateway unreachable" hint="Could not load LLM status." />}
      </div>
    </>
  );
}
