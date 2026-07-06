import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';
import { DecisionButtons, RunReviewButton } from './controls';
import { IntakePanel } from './intake-panel';

export const dynamic = 'force-dynamic';

/** Phase AB — Personal Command Center. Every number on this page is real,
 *  user-scoped data; empty states say exactly what is missing and how to add
 *  it. No fake cards, no invented intelligence. */
export default async function MePage() {
  const [ctx, reality, actions, opportunities, risks, briefings] = await Promise.all([
    gateway.meContext(),
    gateway.realityProfile(),
    gateway.realityNextActions(),
    gateway.realityOpportunities(),
    gateway.realityRisks(),
    gateway.realityBriefings(),
  ]);
  const acts = (actions ?? []).filter((a) => a.status === 'proposed').slice(0, 5);
  const opps = opportunities ?? [];
  const rsk = (risks ?? []).filter((r) => r.status === 'active');
  const missing = reality?.graph.missingData ?? [];
  const latestBriefing = (briefings ?? [])[0];
  return (
    <>
      <PageHeader
        title={`${ctx?.actor.displayName ?? 'Personal'} — Command Center`}
        subtitle={`Scope: personal (${ctx?.tenant?.name ?? ''}) · data freshness: ${reality?.graph.dataFreshness?.slice(0, 10) ?? 'no data yet'} · ${ctx?.activeConsents ?? 0} connector consent(s) · ${ctx?.activeGoals ?? 0} active goal(s)`}
        actions={<RunReviewButton type="daily" label="Run daily briefing" />}
      />
      <IntakePanel />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Top priority" value={acts[0] ? String(acts[0].title).slice(0, 40) : '—'} hint={acts[0] ? `score ${acts[0].priorityScore}` : 'no rankable actions yet'} tone={acts[0] ? 'ok' : undefined} />
        <MetricCard label="Opportunity radar" value={opps.length} hint={opps[0] ? `top: ${String(opps[0].title).slice(0, 32)}` : 'none recorded'} />
        <MetricCard label="Risk radar" value={rsk.length} tone={rsk.length ? 'warn' : 'ok'} hint={rsk[0] ? `${String(rsk[0].title).slice(0, 32)} (${rsk[0].severity})` : 'none recorded'} />
        <MetricCard label="Missing data" value={missing.length} tone={missing.length ? 'warn' : 'ok'} hint={missing[0] ? String(missing[0]).slice(0, 40) : 'baseline complete'} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Next best actions — your decisions train scoped memory</div>
        {acts.length === 0 ? (
          <EmptyState icon="·" title="Nothing to rank yet" hint="Use the intake panel above to add identity, one goal, one consent and one fact. Then run daily briefing or ask Jarvis for next actions." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {acts.map((a, i) => (
              <div key={i} className="glass" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{String(a.title)} <span className={`badge ${a.category === 'risk' ? 'err' : a.category === 'income' ? 'ok' : ''}`} style={{ marginLeft: 6 }}>{String(a.category)}</span></div>
                  <div className="m" style={{ fontSize: 11.5 }}>{String(a.reason).slice(0, 180)} · score {String(a.priorityScore)} · {String(a.source)} ({String(a.confidence)})</div>
                </div>
                <DecisionButtons actionId={String(a.actionId)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="label" style={{ marginBottom: 8 }}>Latest briefing {latestBriefing ? `(${String(latestBriefing.date)})` : ''}</div>
          {latestBriefing ? (
            <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(latestBriefing.topPriorities as string[]).map((p, i) => <div key={i}>{i + 1}. {p}</div>)}
              <div className="m" style={{ fontSize: 11.5 }}>AOS: {String(latestBriefing.aosAction)}</div>
              {(latestBriefing.sourcesNotConfigured as string[]).length > 0 && <div className="m" style={{ fontSize: 11 }}>{(latestBriefing.sourcesNotConfigured as string[]).join(' · ')}</div>}
            </div>
          ) : <EmptyState icon="·" title="No briefing yet" hint="Run one with the button above — it uses only your real scoped data." />}
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 8 }}>Missing data — how to improve my intelligence</div>
          {missing.length === 0 ? <EmptyState icon="·" title="Baseline complete" hint="Next lever: connect read-only sources via consents." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {missing.slice(0, 8).map((m, i) => <div key={i} className="m">— {String(m)}</div>)}
            </div>
          )}
        </div>
      </div>

      <div className="m" style={{ fontSize: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/me/reality">Reality</Link><Link href="/me/goals">Goals</Link><Link href="/me/projects">Projects</Link>
        <Link href="/me/systems">Systems</Link><Link href="/me/opportunities">Opportunities</Link><Link href="/me/briefing">Briefings</Link>
        <Link href="/me/strategy">Strategy</Link><Link href="/me/resume">Resume</Link>
      </div>
    </>
  );
}
