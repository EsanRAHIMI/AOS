import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { syncDokployAction, runDokployDiagnosticsAction } from '@/app/actions';

/** Phase 17 — real Dokploy calibration status on the overview (honest when unreachable). */
export async function DokployCalibration() {
  const [status, diagnostics, mapping] = await Promise.all([
    gateway.dokployStatus(),
    gateway.dokployDiagnostics() as Promise<Array<Record<string, unknown>> | null>,
    gateway.dokployMapping(),
  ]);
  const configured = Boolean(status?.configured);
  const connected = Boolean(status?.connection?.ok);
  const diags = diagnostics ?? [];
  const supported = diags.filter((d) => d.supported && d.method === 'GET');
  const unsupported = diags.filter((d) => !d.supported && d.method === 'GET');
  const rows = mapping?.mapping ?? [];
  const mapped = rows.filter((m) => m.status === 'mapped');

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="label">Dokploy calibration</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {configured
            ? <span className={`badge ${connected ? 'ok' : 'err'}`}>{connected ? 'connected' : `error${status?.connection?.error ? `: ${status.connection.error}` : ''}`}</span>
            : <span className="badge warn">not configured — manual path</span>}
          {configured && (
            <>
              <form action={runDokployDiagnosticsAction}><button type="submit" className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}>Run diagnostics</button></form>
              <form action={syncDokployAction}><button type="submit" className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}>Sync targets</button></form>
            </>
          )}
        </div>
      </div>

      {!configured ? (
        <p className="m" style={{ fontSize: 13, marginTop: 0 }}>
          Set <code>DOKPLOY_BASE_URL</code> and <code>DOKPLOY_API_TOKEN</code> on the gateway to calibrate against your real Dokploy instance. Until then, operations use the exact manual-instruction path and real <code>/health</code> + registry verification — nothing is faked.
        </p>
      ) : (
        <div className="grid cols-3" style={{ gap: 12 }}>
          <div>
            <div className="m" style={{ fontSize: 12 }}>Synced targets · last sync</div>
            <div style={{ fontSize: 14 }}>{status?.apiTargetCount ?? 0} · {status?.lastSyncedAt ? timeAgo(status.lastSyncedAt) : 'never'}</div>
          </div>
          <div>
            <div className="m" style={{ fontSize: 12 }}>Supported read endpoints</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {supported.length === 0 ? <span className="m" style={{ fontSize: 12.5 }}>run diagnostics</span> : supported.map((d, i) => <span key={i} className="badge ok" style={{ fontSize: 10 }}>{String(d.category)}</span>)}
            </div>
          </div>
          <div>
            <div className="m" style={{ fontSize: 12 }}>Unsupported / not probed</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {unsupported.length === 0 ? <span className="m" style={{ fontSize: 12.5 }}>—</span> : unsupported.map((d, i) => <span key={i} className="badge err" style={{ fontSize: 10 }}>{String(d.category)}</span>)}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div className="m" style={{ fontSize: 12, marginBottom: 8 }}>AOS service ↔ Dokploy mapping — {mapped.length}/{rows.length} mapped</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rows.map((m) => (
            <span key={m.serviceId} className={`badge ${m.status === 'mapped' ? 'ok' : ''}`} title={m.status === 'mapped' ? `${m.appName} @ ${m.domain} (${m.lastKnownStatus})` : 'not_found_in_dokploy_sync'} style={{ fontSize: 10 }}>
              {m.serviceId}{m.status === 'mapped' ? ' ✓' : ' ?'}
            </span>
          ))}
        </div>
        {mapped.length === 0 && <p className="m" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>No services matched a Dokploy app yet — each shows <b>not_found_in_dokploy_sync</b> until a successful sync (no targets are invented).</p>}
      </div>
    </div>
  );
}
