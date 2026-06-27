import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { approveRepairPlanAction, rejectRepairPlanAction, requestChangesRepairPlanAction, revalidateIncidentAction } from '@/app/actions';
import { PageHeader, EmptyState, StatusPill } from '@/components/ui';
export const dynamic = 'force-dynamic';

export default async function IncidentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = (await gateway.incidentDetail(id)) as {
    incident: Record<string, unknown>; diagnosis: Record<string, unknown> | null;
    plan: Record<string, unknown> | null; repairTask: Record<string, unknown> | null;
    evidence: Array<Record<string, unknown>>;
  } | null;
  if (!res?.incident) return (<><PageHeader title="Incident" crumbs={[['/incidents', 'Incidents'], [`/incidents/${id}`, id]]} /><div className="card"><EmptyState icon="◌" title="Incident not found" /></div></>);
  const { incident, diagnosis, plan, repairTask, evidence } = res;
  const status = String(incident.status);
  const causes = diagnosis && Array.isArray(diagnosis.suspectedCauses) ? (diagnosis.suspectedCauses as Array<{ cause: string; confidence: number; evidence: string[] }>) : [];
  const planSteps = plan && Array.isArray(plan.steps) ? (plan.steps as string[]) : [];
  const planStatus = plan ? String(plan.status) : '';
  const planOpen = planStatus === 'waiting_approval' || planStatus === 'changes_requested';

  return (
    <>
      <PageHeader
        title={`Incident · ${String(incident.serviceName)}`}
        subtitle={String(incident.detail)}
        crumbs={[['/incidents', 'Incidents'], [`/incidents/${id}`, String(incident.serviceName)]]}
        actions={<StatusPill status={status} />}
      />

      <div className="grid cols-2">
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Why the system thinks it failed</div>
          {!diagnosis ? <EmptyState icon="◇" title="No diagnosis yet" hint='Run "Repair <service> activation failure".' /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {causes.map((c, i) => (
                <div key={i} className="glass" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <b style={{ fontSize: 13.5 }}>{c.cause}</b>
                    <span className="badge warn">{Math.round(c.confidence * 100)}%</span>
                  </div>
                  {(c.evidence ?? []).length > 0 && <div className="m" style={{ fontSize: 12, marginTop: 4 }}>{(c.evidence ?? []).join('; ')}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Repair plan {plan ? `(${String(plan.planType)})` : ''}</div>
          {!plan ? <EmptyState icon="◇" title="No plan yet" /> : (
            <>
              <ol className="sub" style={{ marginTop: 0, paddingLeft: 18 }}>{planSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <div className="sub">Status: <span className={`badge ${planStatus === 'executed' ? 'ok' : planStatus === 'rejected' ? 'err' : 'warn'}`}>{planStatus}</span></div>
              {planOpen && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <form action={approveRepairPlanAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input type="hidden" name="id" value={String(plan.repairPlanId)} />
                    <input type="hidden" name="incidentId" value={id} />
                    <input name="baseUrl" placeholder="corrected base URL (optional)" style={{ flex: 1, minWidth: 180, fontSize: 13 }} />
                    <button className="btn btn-ok" type="submit">Approve &amp; execute</button>
                  </form>
                  <div className="actions">
                    <form action={requestChangesRepairPlanAction}><input type="hidden" name="id" value={String(plan.repairPlanId)} /><button className="btn btn-ghost" type="submit">Request changes</button></form>
                    <form action={rejectRepairPlanAction}><input type="hidden" name="id" value={String(plan.repairPlanId)} /><button className="btn btn-err" type="submit">Reject</button></form>
                  </div>
                </div>
              )}
              {status !== 'resolved' && (
                <form action={revalidateIncidentAction} style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="hidden" name="id" value={id} />
                  <input name="baseUrl" placeholder="reachable URL after manual fix" style={{ flex: 1, minWidth: 180, fontSize: 13 }} />
                  <button className="btn btn-ok" type="submit">Mark manual done &amp; re-check</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Repair evidence ({evidence.length})</div>
        {evidence.length === 0 ? <EmptyState icon="✦" title="No evidence" /> : (
          <div className="feed">
            {evidence.map((e, i) => (<div key={i}><span className="t">{String(e.type)}</span> <span className="m">— {String(e.summary)} · {timeAgo(String(e.createdAt))}</span></div>))}
          </div>
        )}
        {repairTask && <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>Repair task: <b>{String(repairTask.status)}</b> · attempts {String(repairTask.attempts ?? 0)}</p>}
      </div>
    </>
  );
}
