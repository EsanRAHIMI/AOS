import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function LlmCostsPage() {
  const [costs, budget] = await Promise.all([gateway.llmCosts(), gateway.llmBudgetEvents() as Promise<Array<Record<string, unknown>> | null>]);
  const t = costs?.totals;
  const budgets = budget ?? [];
  return (
    <>
      <PageHeader title="LLM Costs & Budget" subtitle="Token/cost tracking by provider, model and agent, with budget events when limits force deterministic fallback." />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Cost today" value={`$${(t?.today ?? 0).toFixed(4)}`} />
        <MetricCard label="Cost all-time" value={`$${(t?.allTime ?? 0).toFixed(4)}`} hint={`${t?.calls ?? 0} calls`} />
        <MetricCard label="Fallback calls" value={t?.fallbackCount ?? 0} tone={(t?.fallbackCount ?? 0) > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Most expensive task" value={costs?.mostExpensiveTask ? `$${costs.mostExpensiveTask.costUsd.toFixed(4)}` : '—'} hint={costs?.mostExpensiveTask?.taskId ?? ''} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>By provider</div>
          {!costs || Object.keys(costs.byProvider).length === 0 ? <EmptyState icon="✦" title="No LLM calls yet" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(costs.byProvider).map(([p, v]) => (
                <div key={p} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{p}</span><span className="m">{v.calls} calls · ${v.costUsd.toFixed(4)}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>By agent</div>
          {!costs || Object.keys(costs.byAgent).length === 0 ? <EmptyState icon="✦" title="No LLM calls yet" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(costs.byAgent).map(([a, v]) => (
                <div key={a} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{a}</span><span className="m">{v.calls} · ${v.costUsd.toFixed(4)}</span></div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span className="label">Budget events</span>
          <Link href="/llm" className="chip">LLM overview</Link>
        </div>
        {budgets.length === 0 ? (
          <EmptyState icon="✓" title="No budget events" hint="When a task reaches its cost limit, the kernel switches to deterministic fallback and records it here." />
        ) : (
          <div className="timeline">
            {budgets.map((b, i) => (
              <div className="ti warn" key={i}>
                <div className="m" style={{ fontSize: 11.5 }}>{timeAgo(String(b.createdAt))} · {String(b.scope)} · {String(b.action)}</div>
                <div style={{ fontSize: 13 }}>{String(b.detail)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
