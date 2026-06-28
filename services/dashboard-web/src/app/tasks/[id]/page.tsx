import { gateway } from '@/lib/gateway';
import { LiveTaskTimeline, type TimelineRow } from '@/components/LiveTaskTimeline';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState, StatusPill } from '@/components/ui';
export const dynamic = 'force-dynamic';

interface ReportStep { service: string; message: string; ok: boolean }
interface TaskReport {
  headline?: string; status?: string; steps?: ReportStep[];
  infrastructureRequestId?: string | null; approvalId?: string | null;
  memoryId?: string | null; documents?: string[];
  validationId?: string | null; githubBranch?: string | null; capabilityStatus?: string | null;
  browserPassed?: boolean; evidenceCount?: number; checklistId?: string | null;
  mode?: string; selectedLabel?: string | null; selectionReason?: string | null;
  rejected?: Array<{ planId: string; label: string; reason: string }>; planCount?: number;
  llmProvider?: string; usedFallback?: boolean; llmCostUsd?: number; traceId?: string | null;
  confidence?: number; decisionId?: string | null;
  policyDecisions?: Array<{ action: string; decision: string }>;
  recordsAnalyzed?: number; reliabilityCount?: number; patternCount?: number;
  successPatterns?: string[]; failurePatterns?: string[]; recommendationCount?: number; learningRunId?: string | null;
  workflowId?: string | null; workflowType?: string; impact?: string;
  workflowSteps?: Array<{ name: string; engine: string; status: string }>;
  beforeMetrics?: Record<string, number>; afterMetrics?: Record<string, number>;
  // Phase 13 — intelligence
  research?: { reportId: string; mode: string; sourceCount: number } | null;
  planId?: string | null; reviewId?: string | null; reviewPassed?: boolean | null;
  qaId?: string | null; qaPassed?: boolean | null; reportId?: string | null;
  llmMode?: string;
}

export default async function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [task, timeline, evidence] = await Promise.all([
    gateway.task(id) as Promise<Record<string, unknown> | null>,
    gateway.taskTimeline(id) as Promise<Array<Record<string, unknown>> | null>,
    gateway.evidence(`?taskId=${id}`) as Promise<Array<Record<string, unknown>> | null>,
  ]);

  if (!task) return (<><PageHeader title="Task" crumbs={[['/tasks', 'Tasks'], [`/tasks/${id}`, id]]} /><div className="card"><EmptyState icon="◇" title="Task not found" hint="It may have been removed or the id is incorrect." /></div></>);

  const initial: TimelineRow[] = (timeline ?? []).map((e) => ({
    type: String(e.type),
    message: String((e.payload as Record<string, unknown>)?.message ?? e.type),
    source: String(e.source ?? 'system'),
    at: String(e.createdAt ?? new Date().toISOString()),
    level: String((e.payload as Record<string, unknown>)?.level ?? ''),
  }));
  const report = (task.result ?? null) as TaskReport | null;
  const status = String(task.status);

  const MODE_LABEL: Record<string, string> = {
    intelligence: 'Researched the topic, produced an evidence-grounded plan, reviewed it, QA-checked it, and wrote an executive report.',
    strategic_reasoning: 'Reasoned over multiple candidate plans, scored them, checked policy, and selected one with justification.',
    learning: 'Analyzed the kernel’s history to compute reliability, mine patterns, and produce recommendations.',
    improvement: 'Converted an approved recommendation into a structured workflow and measured its impact.',
    delegation: 'Delegated the goal across architect, builder, devops, documentation and memory agents.',
    activation: 'Validated a capability against reality, delivered it, and browser-tested it.',
    repair: 'Diagnosed an incident and prepared a repair plan for your approval.',
    production_activation: 'Prepared a production activation checklist for you to create in Dokploy.',
    build_from_proposal: 'Built a new service from an approved expansion proposal.',
    capability_analysis: 'Analyzed required capabilities and detected gaps.',
  };
  const did = report?.mode ? (MODE_LABEL[report.mode] ?? 'Ran the appropriate pipeline for this goal.') : 'Work is in progress.';
  const nextStep =
    status === 'awaiting_approval' ? 'This task is paused for your approval — review it in Approvals (and Infrastructure for deploys).'
    : status === 'completed' ? 'Done. Review the evidence below; explore Reports and Evidence for the full proof.'
    : status === 'failed' || status === 'cancelled' ? 'This task did not complete — check the timeline and evidence for why, then try again or repair the service.'
    : 'In progress — watch the live timeline on the left.';

  return (
    <>
      <PageHeader
        title={String(task.goal)}
        subtitle="Mission control — every plan, action, and decision the kernel took for this goal, streamed live."
        crumbs={[['/tasks', 'Tasks'], [`/tasks/${id}`, id]]}
        actions={<StatusPill status={status} />}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 8 }}>In plain language</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13.5 }}>
          <span className="m">Your goal</span><span>{String(task.goal)}</span>
          <span className="m">What the kernel did</span><span>{did}</span>
          <span className="m">Status</span><span><StatusPill status={status} /></span>
          <span className="m">What to do next</span><span>{nextStep}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <LiveTaskTimeline taskId={id} initial={initial} />

        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Final report</div>
          {!report ? (
            <EmptyState icon="✦" title="Report pending" hint="The final report appears once the pipeline finishes." />
          ) : (
            <div>
              <p style={{ marginTop: 0 }}>{report.headline}</p>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {(report.steps ?? []).map((s, i) => (
                      <tr key={i}>
                        <td className="m" style={{ width: 160 }}>{s.service}</td>
                        <td>{s.message}</td>
                        <td><span className={`badge ${s.ok ? 'ok' : 'warn'}`}>{s.ok ? 'ok' : 'skip'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sub" style={{ marginTop: 12 }}>
                {report.infrastructureRequestId && <>Infra request: <b>{report.infrastructureRequestId}</b> · </>}
                {report.approvalId && <>Approval: <b>{report.approvalId}</b> · </>}
                {report.memoryId && <>Memory: <b>{report.memoryId}</b></>}
              </div>
              {(report.validationId || report.githubBranch || report.capabilityStatus) && (
                <div className="sub" style={{ marginTop: 12 }}>
                  {report.validationId && <>Validation: <b>{report.validationId}</b> · </>}
                  {report.githubBranch && <>Branch: <b>{report.githubBranch}</b> · </>}
                  {report.checklistId && <>Checklist: <b>{report.checklistId}</b> · </>}
                  {report.capabilityStatus && <>Capability: <b>{report.capabilityStatus}</b></>}
                </div>
              )}
              {report.approvalId && status === 'awaiting_approval' && (
                <p className="sub" style={{ marginTop: 8 }}>Approve in the <b>Approvals</b> tab, then confirm in <b>Infrastructure</b>.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {report?.mode === 'strategic_reasoning' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>Reasoning trail</div>
          <p style={{ marginTop: 0 }}>
            Considered <b>{report.planCount}</b> plans · selected <b>{report.selectedLabel}</b> · confidence {Number(report.confidence ?? 0).toFixed(2)} ·
            reasoning via <b>{report.llmProvider}{report.usedFallback ? ' (fallback)' : ''}</b>
            {report.traceId ? <> · <a href={`/llm-traces/${report.traceId}`}>trace</a></> : null}
            {typeof report.llmCostUsd === 'number' ? <> · ${report.llmCostUsd.toFixed(4)}</> : null}
          </p>
          <p className="sub" style={{ marginTop: 0 }}><b>Why:</b> {report.selectionReason}</p>
          {(report.rejected ?? []).length > 0 && (
            <div className="sub"><b>Rejected:</b> {(report.rejected ?? []).map((r) => `${r.label} — ${r.reason}`).join(' · ')}</div>
          )}
          {(report.policyDecisions ?? []).length > 0 && (
            <div className="sub" style={{ marginTop: 6 }}><b>Policy:</b> {(report.policyDecisions ?? []).map((p) => `${p.action}→${p.decision}`).join(', ')}</div>
          )}
          {report.decisionId && <div className="sub" style={{ marginTop: 6 }}>Decision memory: <b>{report.decisionId}</b></div>}
        </div>
      )}

      {report?.mode === 'learning' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>Learning report</div>
          <p style={{ marginTop: 0 }}>Analyzed <b>{report.recordsAnalyzed}</b> records · {report.reliabilityCount} reliability scores · {report.patternCount} patterns · {report.recommendationCount} recommendation(s).</p>
          {(report.successPatterns ?? []).length > 0 && <p className="sub" style={{ margin: 0 }}><b>Success:</b> {(report.successPatterns ?? []).join(' · ')}</p>}
          {(report.failurePatterns ?? []).length > 0 && <p className="sub" style={{ marginTop: 4 }}><b>Weak points:</b> {(report.failurePatterns ?? []).join(' · ')}</p>}
          <p className="sub" style={{ marginTop: 6 }}>Review them in <a href="/system-recommendations">Recommendations</a>, <a href="/reliability">Reliability</a>, and <a href="/patterns">Patterns</a>.</p>
        </div>
      )}

      {report?.mode === 'improvement' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>Improvement workflow ({report.workflowType})</div>
          <p style={{ marginTop: 0 }}>Impact: <b>{report.impact}</b> {report.workflowId ? <> · <a href={`/improvement-workflows/${report.workflowId}`}>workflow</a></> : null}</p>
          {(report.workflowSteps ?? []).length > 0 && (
            <div className="feed">{(report.workflowSteps ?? []).map((s, i) => (<div key={i}><span className="t">{s.engine}</span> <span className="m">— {s.name}</span> <span className={`badge ${s.status === 'done' ? 'ok' : s.status === 'skipped' ? 'warn' : ''}`}>{s.status}</span></div>))}</div>
          )}
        </div>
      )}

      {report?.mode === 'intelligence' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>Real intelligence report</div>
          <p style={{ marginTop: 0 }}>
            Reasoning: <b>{report.llmMode === 'real' ? 'real LLM provider' : 'deterministic fallback'}</b>
            {typeof report.llmCostUsd === 'number' ? <> · cost <b>${report.llmCostUsd.toFixed(4)}</b></> : null}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {report.research && <a href={`/research/${report.research.reportId}`} className="chip">Research · {report.research.sourceCount} sources ({report.research.mode})</a>}
            {report.planId && <span className="chip">Plan: {report.planId}</span>}
            {report.reviewId && <a href="/reviews" className={`badge ${report.reviewPassed ? 'ok' : 'err'}`}>Review {report.reviewPassed ? 'passed' : 'failed'}</a>}
            {report.qaId && <a href="/qa" className={`badge ${report.qaPassed ? 'ok' : 'err'}`}>QA {report.qaPassed ? 'passed' : 'failed'}</a>}
            {report.reportId && <a href="/reports" className="chip">Executive report</a>}
          </div>
          <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>{report.headline}</p>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Evidence ({(evidence ?? []).length})</div>
        {!evidence || evidence.length === 0 ? (
          <div className="empty">No evidence recorded for this task.</div>
        ) : (
          <div className="feed">
            {evidence.map((e, i) => (
              <div key={i}>
                <span className="t">{String(e.type)}</span> <span className="m">— {String(e.summary)} · {timeAgo(String(e.createdAt))}</span>
                {e.s3ObjectId ? <span className="badge ok" style={{ marginLeft: 6 }}>S3</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
