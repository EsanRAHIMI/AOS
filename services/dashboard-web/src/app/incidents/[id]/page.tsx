import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { approveRepairPlanAction, rejectRepairPlanAction, requestChangesRepairPlanAction, revalidateIncidentAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

export default async function IncidentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = (await gateway.incidentDetail(id)) as {
    incident: Record<string, unknown>; diagnosis: Record<string, unknown> | null;
    plan: Record<string, unknown> | null; repairTask: Record<string, unknown> | null;
    evidence: Array<Record<string, unknown>>;
  } | null;
  if (!res?.incident) return (<><h1 className="h1">Incident</h1><div className="card"><div className="empty">Not found.</div></div></>);
  const { incident, diagnosis, plan, repairTask, evidence } = res;
  const status = String(incident.status);
  const causes = diagnosis && Array.isArray(diagnosis.suspectedCauses) ? (diagnosis.suspectedCauses as Array<{ cause: string; confidence: number; evidence: string[] }>) : [];
  const planSteps = plan && Array.isArray(plan.steps) ? (plan.steps as string[]) : [];
  const planStatus = plan ? String(plan.status) : '';
  const planOpen = planStatus === 'waiting_approval' || planStatus === 'changes_requested';

  return (
    <>
      <h1 className="h1">Incident · {String(incident.serviceName)}</h1>
      <p className="sub"><span className={`badge ${status === 'resolved' ? 'ok' : status === 'failed' ? 'err' : 'warn'}`}>{status}</span> · {String(incident.detail)}</p>

      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Why the system thinks it failed</div>
          {!diagnosis ? <div className="empty">No diagnosis yet. Run "Repair &lt;service&gt; activation failure".</div> : (
            <table><tbody>
              {causes.map((c, i) => (
                <tr key={i}><td>{c.cause}</td><td><span className="badge warn">{Math.round(c.confidence * 100)}%</span></td><td className="m">{(c.evidence ?? []).join('; ')}</td></tr>
              ))}
            </tbody></table>
          )}
        </div>

        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Repair plan {plan ? `(${String(plan.planType)})` : ''}</div>
          {!plan ? <div className="empty">No plan yet.</div> : (
            <>
              <ol className="sub" style={{ marginTop: 0, paddingLeft: 18 }}>{planSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <div className="sub">Status: <span className={`badge ${planStatus === 'executed' ? 'ok' : planStatus === 'rejected' ? 'err' : 'warn'}`}>{planStatus}</span></div>
              {planOpen && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <form action={approveRepairPlanAction} style={{ display: 'flex', gap: 8 }}>
                    <input type="hidden" name="id" value={String(plan.repairPlanId)} />
                    <input type="hidden" name="incidentId" value={id} />
                    <input name="baseUrl" placeholder="corrected base URL (optional)" style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12, width: 230 }} />
                    <button className="btn-ok" type="submit">Approve &amp; execute</button>
                  </form>
                  <form action={requestChangesRepairPlanAction} style={{ display: 'inline' }}><input type="hidden" name="id" value={String(plan.repairPlanId)} /><button className="btn-err" type="submit">Request changes</button></form>
                  <form action={rejectRepairPlanAction} style={{ display: 'inline' }}><input type="hidden" name="id" value={String(plan.repairPlanId)} /><button className="btn-err" type="submit">Reject</button></form>
                </div>
              )}
              {status !== 'resolved' && (
                <form action={revalidateIncidentAction} style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <input type="hidden" name="id" value={id} />
                  <input name="baseUrl" placeholder="reachable URL after manual fix" style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12, width: 230 }} />
                  <button className="btn-ok" type="submit">Mark manual done &amp; re-check</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Repair evidence ({evidence.length})</div>
        {evidence.length === 0 ? <div className="empty">No evidence.</div> : (
          <div className="feed">
            {evidence.map((e, i) => (<div key={i}><span className="t">{String(e.type)}</span> <span className="m">— {String(e.summary)} · {timeAgo(String(e.createdAt))}</span></div>))}
          </div>
        )}
        {repairTask && <p className="sub" style={{ marginTop: 10 }}>Repair task: <b>{String(repairTask.status)}</b> · attempts {String(repairTask.attempts ?? 0)}</p>}
      </div>
    </>
  );
}
