import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { createTaskAction } from '@/app/actions';

interface Suggestion { priority: number; tone: 'err' | 'warn' | 'ok'; title: string; why: string; href?: string; runPrompt?: string; cta: string }

/** "Next best action" — derived only from real system state. No fake suggestions. */
export async function NextBestAction() {
  const [approvals, incidents, secChecks, learningRuns, recs, safe, llm] = await Promise.all([
    gateway.approvals() as Promise<unknown[] | null>,
    gateway.incidents() as Promise<Array<Record<string, unknown>> | null>,
    gateway.securityChecks() as Promise<unknown[] | null>,
    gateway.learningRuns() as Promise<unknown[] | null>,
    gateway.systemRecommendations() as Promise<Array<Record<string, unknown>> | null>,
    gateway.safeMode(),
    gateway.llmCosts(),
  ]);

  const openIncidents = (incidents ?? []).filter((i) => i.status !== 'resolved' && i.status !== 'closed').length;
  const pendingRecs = (recs ?? []).filter((r) => r.status === 'waiting_approval' || r.status === 'proposed').length;
  const s: Suggestion[] = [];

  if (safe?.enabled) s.push({ priority: 0, tone: 'warn', title: 'Safe mode is ON', why: 'Mutation, deploy, repair and governance actions are blocked.', href: '/security/safe-mode', cta: 'Review safe mode' });
  if ((approvals ?? []).length > 0) s.push({ priority: 1, tone: 'warn', title: `${(approvals ?? []).length} approval(s) waiting`, why: 'Sensitive actions are paused until you decide.', href: '/approvals', cta: 'Open approvals' });
  if (openIncidents > 0) s.push({ priority: 2, tone: 'err', title: `${openIncidents} open incident(s)`, why: 'A service needs attention or repair.', href: '/incidents', cta: 'Review incidents' });
  if ((secChecks ?? []).length === 0) s.push({ priority: 3, tone: 'warn', title: 'No security check yet', why: 'Verify env, secrets, tokens and safe mode are healthy.', runPrompt: 'Run production security hardening check.', cta: 'Run security check' });
  if ((learningRuns ?? []).length === 0) s.push({ priority: 4, tone: 'ok', title: 'No learning run yet', why: 'Let the kernel analyze its history and recommend improvements.', runPrompt: 'Analyze system history and recommend improvements.', cta: 'Analyze history' });
  if (pendingRecs > 0) s.push({ priority: 5, tone: 'ok', title: `${pendingRecs} recommendation(s) to review`, why: 'Approve to turn them into improvement workflows.', href: '/system-recommendations', cta: 'Review recommendations' });
  if (llm && llm.status?.mode !== 'real') s.push({ priority: 6, tone: 'ok', title: 'AI running on deterministic fallback', why: 'Set a provider key to enable real LLM reasoning (keys stay server-side).', href: '/llm', cta: 'See LLM status' });
  if (s.length === 0) s.push({ priority: 9, tone: 'ok', title: 'All clear', why: 'Nothing needs you right now. Try a research + improvement plan.', runPrompt: 'Research current best practices for securing autonomous agent dashboards and create an improvement plan.', cta: 'Research & plan' });

  const top = s.sort((a, b) => a.priority - b.priority).slice(0, 4);
  return (
    <div className="card">
      <div className="label" style={{ marginBottom: 12 }}>Next best action</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {top.map((x, i) => (
          <div key={i} className="glass" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`dot ${x.tone === 'ok' ? 'on' : ''}`} style={x.tone !== 'ok' ? { background: x.tone === 'err' ? 'var(--err)' : 'var(--warn)' } : undefined} />
                <b style={{ fontSize: 13.5 }}>{x.title}</b>
              </div>
              <div className="m" style={{ fontSize: 12.5, marginTop: 2 }}>{x.why}</div>
            </div>
            {x.href ? (
              <Link href={x.href} className="btn btn-ghost" style={{ padding: '7px 14px', fontSize: 12.5 }}>{x.cta}</Link>
            ) : (
              <form action={createTaskAction}><input type="hidden" name="goal" value={x.runPrompt} /><button className="btn btn-primary" type="submit" style={{ padding: '7px 14px', fontSize: 12.5 }}>{x.cta}</button></form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
