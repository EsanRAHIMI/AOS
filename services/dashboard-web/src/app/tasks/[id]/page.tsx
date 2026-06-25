import { gateway } from '@/lib/gateway';
import { LiveTaskTimeline, type TimelineRow } from '@/components/LiveTaskTimeline';
export const dynamic = 'force-dynamic';

interface ReportStep { service: string; message: string; ok: boolean }
interface TaskReport {
  headline?: string; status?: string; steps?: ReportStep[];
  infrastructureRequestId?: string | null; approvalId?: string | null;
  memoryId?: string | null; documents?: string[];
}

export default async function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [task, timeline] = await Promise.all([
    gateway.task(id) as Promise<Record<string, unknown> | null>,
    gateway.taskTimeline(id) as Promise<Array<Record<string, unknown>> | null>,
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
              {report.approvalId && status === 'awaiting_approval' && (
                <p className="sub" style={{ marginTop: 8 }}>Approve in the <b>Approvals</b> tab, then confirm in <b>Infrastructure</b>.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
