import { gateway } from '@/lib/gateway';
import { SERVICE_CATALOG } from '@/lib/services-catalog';
import { timeAgo } from '@/lib/format';

const boundaryTone = (b: string) => (b === 'internal' ? '' : b === 'public-api' ? 'warn' : 'ok');
const boundaryLabel = (b: string) => (b === 'internal' ? 'internal (token-protected)' : b === 'public-api' ? 'public API (auth required)' : 'public UI');

/** Real service map: documented catalog merged with live service-registry data. */
export async function SystemMap() {
  const live = (await gateway.services()) as Array<Record<string, unknown>> | null;
  const byId = new Map((live ?? []).map((s) => [String(s.serviceId), s]));
  const registeredCount = (live ?? []).length;

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card metric"><div className="label">Services (catalog)</div><div className="stat">{SERVICE_CATALOG.length}</div></div>
        <div className="card metric"><div className="label">Registered now</div><div className="stat" style={{ color: registeredCount ? 'var(--ok)' : 'var(--warn)', WebkitTextFillColor: 'initial', background: 'none' }}>{registeredCount}</div></div>
        <div className="card metric"><div className="label">Agents</div><div className="stat">{SERVICE_CATALOG.filter((c) => c.id.endsWith('-agent')).length}</div></div>
        <div className="card metric"><div className="label">Public surface</div><div className="stat" style={{ WebkitTextFillColor: 'initial', background: 'none', fontSize: 20 }}>2</div><div className="m" style={{ fontSize: 12 }}>UI + API only</div></div>
      </div>

      <div className="card-grid">
        {SERVICE_CATALOG.map((c) => {
          const s = byId.get(c.id);
          const registered = Boolean(s);
          const caps = s && Array.isArray(s.capabilities) ? (s.capabilities as string[]) : [];
          return (
            <div className="card" key={c.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <b style={{ fontSize: 14 }}>{c.id}</b>
                <span className={`badge ${registered ? 'ok' : ''}`}>{registered ? String(s!.deploymentStatus ?? 'registered') : 'not registered'}</span>
              </div>
              <div className="m" style={{ fontSize: 12.5, marginBottom: 8 }}>{c.role}</div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0, fontSize: 12.5 }}>
                <dt className="m">Domain</dt><dd style={{ margin: 0, wordBreak: 'break-all' }}>{c.subdomain}</dd>
                <dt className="m">Port</dt><dd style={{ margin: 0 }}>{c.port}</dd>
                <dt className="m">Boundary</dt><dd style={{ margin: 0 }}><span className={`badge ${boundaryTone(c.boundary)}`}>{boundaryLabel(c.boundary)}</span></dd>
                <dt className="m">Last seen</dt><dd style={{ margin: 0 }}>{registered && s!.lastSeenAt ? timeAgo(String(s!.lastSeenAt)) : '—'}</dd>
                {registered && s!.version ? (<><dt className="m">Version</dt><dd style={{ margin: 0 }}>v{String(s!.version)}</dd></>) : null}
              </dl>
              {caps.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {caps.slice(0, 5).map((cap) => <span key={cap} className="chip">{cap}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {registeredCount === 0 && (
        <p className="sub" style={{ marginTop: 14 }}>No services are registered with the live registry right now — boundaries, roles, domains and ports above are the deployed configuration; live status fills in once services register.</p>
      )}
    </>
  );
}
