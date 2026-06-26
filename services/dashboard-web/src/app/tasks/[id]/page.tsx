import { gateway } from '@/lib/gateway';
import { LiveTaskTimeline, type TimelineRow } from '@/components/LiveTaskTimeline';
import { timeAgo } from '@/lib/format';
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
}

export default async function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [task, timeline, evidence] = await Promise.all([
    gateway.task(id) as Promise<Record<string, unknown> | null>,
    gateway.taskTimeline(id) as Promise<Array<Record<string, unknown>> | null>,
    gateway.evidence(`?taskId=${id}`) as Promise<Array<Record<string, unknown>> | null>,
  ]);

  if (!task) return (<><h1 className="h1">Task</h1><div className="card"><div className="empty">Task not found.</div></div></>);

  const initial: TimelineRow[] = (timeline ?? []).map((e) => ({
    type: String(e.type),
    message: String((e.payload as Record<string, unknown>)?.message ?? e.type),
    source: String(e.source ?? 'system'),
    at: String(e.createdAt ?? new Date().toISOString()),
    level: String((e.payload as Record<string, unknown>)?.level ?? ''),
  }));
  const report = (task.result ?? null) as TaskReport | null;
  const status = String(task.status);
  const cls = status === 'completed' ? 'ok' : status === 'failed' || status === 'cancelled' ? 'err' : status === 'awaiting_approval' ? 'warn' : '';

  return (
    <>
      <h1 className="h1">{String(task.goal)}</h1>
      <p className="sub">Task {id} · <span className={`badge ${cls}`}>{status}</span></p>

      <div className="grid cols-2">
        <LiveTaskTimeline taskId={id} initial={initial} />

        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Final report</div>
          {!report ? (
            <div className="empty">Report appears once the pipeline finishes.</div>
          ) : (
            <div>
              <p style={{ marginTop: 0 }}>{report.headline}</p>
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
