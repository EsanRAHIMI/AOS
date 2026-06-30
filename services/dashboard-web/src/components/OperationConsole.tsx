import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { StatusPill } from '@/components/ui';
import { confirmOperationTargetAction, decideOperationAction, markOperationExecutedAction, syncDokployAction, retryOperationAction, rollbackOperationAction } from '@/app/actions';
import { SERVICE_CATALOG } from '@/lib/services-catalog';

const riskTone = (r: string) => (r === 'critical' || r === 'high' ? 'err' : r === 'medium' ? 'warn' : 'ok');
const stepIcon: Record<string, string> = { done: '✓', active: '●', waiting: '◷', failed: '✗', pending: '○', skipped: '–', manual_required: '✋' };
const stepColor: Record<string, string> = { done: 'var(--ok)', active: 'var(--accent)', waiting: 'var(--warn)', failed: 'var(--err)', pending: 'var(--muted-2)', skipped: 'var(--muted-2)', manual_required: 'var(--warn)' };

/** The active-operation Mission Control panel rendered directly on /overview. */
export async function OperationConsole({ role, safeMode }: { role: string; safeMode: boolean }) {
  const [active, dokploy] = await Promise.all([gateway.activeOperation(), gateway.dokployStatus()]);
  const dokBar = (
    <div className="glass" style={{ padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
      <span className="m">Dokploy API:</span>
      {dokploy?.configured
        ? <span className={`badge ${dokploy.connection.ok ? 'ok' : 'err'}`}>{dokploy.connection.ok ? 'connected' : `error${dokploy.connection.error ? `: ${dokploy.connection.error}` : ''}`}</span>
        : <span className="badge warn">not configured — manual path</span>}
      <span className="m">{dokploy?.apiTargetCount ?? 0} synced targets · {dokploy?.lastSyncedAt ? `synced ${timeAgo(dokploy.lastSyncedAt)}` : 'never synced'}</span>
      {dokploy?.configured && (
        <form action={syncDokployAction} style={{ marginLeft: 'auto' }}><button type="submit" className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}>Sync targets</button></form>
      )}
    </div>
  );

  if (!active) {
    return (
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Operations</div>
        {dokBar}
        <div className="m" style={{ fontSize: 13, marginTop: 10 }}>No active operation. Start one above — pick an operation type, and the kernel will show the target, risk, approval, execution (real Dokploy API when configured, exact manual steps otherwise), verification and evidence right here.</div>
      </div>
    );
  }
  const detail = await gateway.operation(String(active.operationPlanId));
  const p = (detail?.plan ?? active) as Record<string, unknown>;
  const snapshot = detail?.snapshot;
  const target = detail?.target;
  const steps = (p.steps as Array<Record<string, unknown>>) ?? [];
  const status = String(p.status);
  const risk = String(p.riskLevel);
  const protectedCore = Boolean(p.protectedCore);
  const verification = p.verification as Record<string, unknown> | null;
  const manual = (p.manualInstructions as string[]) ?? [];
  const requiredApprovals = (p.requiredApprovals as string[]) ?? [];
  const opId = String(p.operationPlanId);
  const canApprove = !((protectedCore || risk === 'critical') && role !== 'owner');

  return (
    <div className="card" style={{ borderColor: protectedCore ? 'rgba(255,107,129,0.4)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="label">Active operation</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${riskTone(risk)}`}>{risk} risk</span>
          {protectedCore && <span className="badge err">protected core</span>}
          <StatusPill status={status} />
        </div>
      </div>
      <b style={{ fontSize: 15 }}>{String(p.goal)}</b>
      <div className="m" style={{ fontSize: 12.5, marginTop: 4, marginBottom: 10 }}>
        {String(p.operationType)} · started {timeAgo(String(p.createdAt))}
        {p.targetApp || p.targetDomain ? ` · ${String(p.targetApp || p.targetService || 'new app')}${p.targetDomain ? ` @ ${String(p.targetDomain)}` : ''}${p.targetPort ? `:${String(p.targetPort)}` : ''}` : ''}
        {target ? ` · target source: ${String(target.source)}` : ''}
      </div>

      <div style={{ marginBottom: 12 }}>{dokBar}</div>

      {/* Next action — always shown */}
      <div className="glass" style={{ padding: '10px 12px', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="dot on" />
        <span style={{ fontSize: 13 }}><b>Next:</b> {String(p.nextAction)}</span>
      </div>

      <div className="grid cols-2">
        {/* Timeline */}
        <div>
          <div className="label" style={{ marginBottom: 8 }}>Timeline</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {steps.map((s, i) => {
              const st = String(s.status);
              const mode = String(s.executionMode ?? 'pending');
              const resp = String(s.responseSummary ?? '');
              const err = String(s.error ?? '');
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, opacity: st === 'pending' || st === 'skipped' ? 0.55 : 1 }}>
                  <span style={{ color: stepColor[st], width: 14, flex: 'none', textAlign: 'center' }}>{stepIcon[st] ?? '○'}</span>
                  <span style={{ flex: 1 }}>
                    {String(s.label)}{s.message ? <span className="m"> — {String(s.message)}</span> : null}
                    {(mode === 'api' || mode === 'manual') && (st === 'done' || st === 'manual_required') ? <span className={`badge ${mode === 'api' ? 'ok' : 'warn'}`} style={{ marginLeft: 6, padding: '1px 7px', fontSize: 10 }}>{mode === 'api' ? 'API' : 'manual'}</span> : null}
                    {resp ? <span className="m" style={{ display: 'block', fontSize: 11 }}>{String(s.apiMethod)} → {resp}</span> : null}
                    {err ? <span style={{ display: 'block', fontSize: 11, color: 'var(--err)' }}>{err}</span> : null}
                  </span>
                  {s.at ? <span className="m" style={{ fontSize: 11 }}>{timeAgo(String(s.at))}</span> : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right column: contextual action card */}
        <div>
          {status === 'waiting_target_selection' && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Confirm target</div>
              <p className="m" style={{ fontSize: 12.5, marginTop: 0 }}>Dokploy API could not confirm this target automatically. Please confirm the project / app / domain before execution.</p>
              <form action={confirmOperationTargetAction} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input type="hidden" name="operationPlanId" value={opId} />
                <input name="projectName" placeholder="Dokploy project (e.g. autonomous-os)" style={{ fontSize: 13 }} />
                <input name="appName" placeholder="App name (e.g. gateway-api)" style={{ fontSize: 13 }} />
                <input name="serviceId" placeholder="Service id (for core-service detection)" list="catalog-services" style={{ fontSize: 13 }} />
                <datalist id="catalog-services">{SERVICE_CATALOG.map((c) => <option key={c.id} value={c.id} />)}</datalist>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input name="domain" placeholder="domain (e.g. api.simorx.com)" style={{ flex: 2, fontSize: 13 }} />
                  <input name="port" placeholder="port" style={{ flex: 1, fontSize: 13 }} />
                </div>
                <input name="rootDir" placeholder="root dir (e.g. services/gateway-api)" style={{ fontSize: 13 }} />
                <button type="submit" className="btn btn-primary">Confirm target</button>
              </form>
            </div>
          )}

          {status === 'waiting_approval' && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Risk &amp; approval</div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: '0 0 10px', fontSize: 12.5 }}>
                <dt className="m">Operation</dt><dd style={{ margin: 0 }}>{String(p.operationType)}</dd>
                <dt className="m">Risk</dt><dd style={{ margin: 0 }}><span className={`badge ${riskTone(risk)}`}>{risk}</span></dd>
                <dt className="m">Protected core</dt><dd style={{ margin: 0 }}>{protectedCore ? 'yes — owner approval required' : 'no'}</dd>
                <dt className="m">Approvals</dt><dd style={{ margin: 0 }}>{requiredApprovals.join(' / ') || 'owner'}</dd>
                <dt className="m">Policy</dt><dd style={{ margin: 0 }}>deploy/env change → approval required</dd>
                <dt className="m">Safe mode</dt><dd style={{ margin: 0 }}><span className={`badge ${safeMode ? 'warn' : 'ok'}`}>{safeMode ? 'ON (blocks execution)' : 'off'}</span></dd>
              </dl>
              {snapshot ? <div className="m" style={{ fontSize: 12, marginBottom: 8 }}>Snapshot will be captured before any change (rollback ready).</div> : null}
              {!canApprove ? (
                <div className="badge err" style={{ padding: '8px 12px' }}>Owner approval required for protected/critical operations.</div>
              ) : (
                <div className="actions">
                  <form action={decideOperationAction}><input type="hidden" name="operationPlanId" value={opId} /><input type="hidden" name="action" value="approve" /><button className="btn btn-ok" type="submit" disabled={safeMode}>Approve</button></form>
                  <form action={decideOperationAction}><input type="hidden" name="operationPlanId" value={opId} /><input type="hidden" name="action" value="request_changes" /><button className="btn btn-ghost" type="submit">Request changes</button></form>
                  <form action={decideOperationAction}><input type="hidden" name="operationPlanId" value={opId} /><input type="hidden" name="action" value="reject" /><button className="btn btn-err" type="submit">Reject</button></form>
                </div>
              )}
            </div>
          )}

          {status === 'running' && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Execute in Dokploy</div>
              {manual.length > 0 ? (
                <ol className="sub" style={{ marginTop: 0, paddingLeft: 18 }}>{manual.map((m, i) => <li key={i}>{m}</li>)}</ol>
              ) : <p className="m" style={{ fontSize: 12.5 }}>Executing via Dokploy API…</p>}
              <form action={markOperationExecutedAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <input type="hidden" name="operationPlanId" value={opId} />
                <input name="baseUrl" placeholder="reachable URL (optional override)" style={{ flex: 1, minWidth: 160, fontSize: 13 }} />
                <button type="submit" className="btn btn-primary">I did this in Dokploy — verify</button>
              </form>
            </div>
          )}

          {(status === 'completed' || status === 'failed' || status === 'verifying') && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Verification</div>
              {!verification ? <p className="m" style={{ fontSize: 12.5 }}>Verifying…</p> : (
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0, fontSize: 12.5 }}>
                  <dt className="m">Domain reachable</dt><dd style={{ margin: 0 }}><VBadge v={verification.domainReachable} /></dd>
                  <dt className="m">/health</dt><dd style={{ margin: 0 }}><VBadge v={verification.healthOk} /></dd>
                  <dt className="m">Registered</dt><dd style={{ margin: 0 }}><VBadge v={verification.registered} /></dd>
                  <dt className="m">Manifest</dt><dd style={{ margin: 0 }}><VBadge v={verification.manifestAvailable} /></dd>
                  <dt className="m">Result</dt><dd style={{ margin: 0 }}>{String(verification.detail)}</dd>
                </dl>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Evidence + links + retry/rollback */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <span className="chip">{((p.evidenceIds as string[]) ?? []).length} evidence</span>
        <Link href="/evidence/explorer" className="chip">Proof &amp; Evidence</Link>
        <Link href="/events" className="chip">Full events</Link>
        <Link href="/logs" className="chip">Logs</Link>
        {snapshot ? <span className="chip">snapshot captured</span> : null}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {status === 'running' && steps.some((s) => s.status === 'manual_required' && s.retryable) && (
            <form action={retryOperationAction}><input type="hidden" name="operationPlanId" value={opId} /><button type="submit" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }}>Retry API</button></form>
          )}
          {status === 'failed' && snapshot && role === 'owner' && (
            <form action={rollbackOperationAction}><input type="hidden" name="operationPlanId" value={opId} /><button type="submit" className="btn btn-err" style={{ padding: '6px 12px', fontSize: 12.5 }}>Rollback (owner)</button></form>
          )}
        </span>
      </div>
    </div>
  );
}

function VBadge({ v }: { v: unknown }) {
  if (v === true) return <span className="badge ok">ok</span>;
  if (v === false) return <span className="badge err">failed</span>;
  return <span className="badge">n/a</span>;
}
