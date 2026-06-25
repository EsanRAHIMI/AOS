import { gateway } from '@/lib/gateway';
import { confirmInfraAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

export default async function InfraPage() {
  const rows = (await gateway.infrastructure()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Infrastructure Requests</h1>
      <p className="sub">Exact infra to create in Dokploy, then confirm. The system never assumes host control.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No infrastructure requests.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Domain</th><th>Port</th><th>Root dir</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const d = (r.dokploy ?? {}) as Record<string, unknown>;
                const id = String(r.requestId);
                const status = String(r.status);
                const done = status === 'fulfilled';
                return (
                  <tr key={i}>
                    <td>{String(r.serviceName)}</td>
                    <td className="m">{String(d.domain ?? '—')}</td>
                    <td>{String(d.port ?? '—')}</td>
                    <td className="m">{String(d.rootDirectory ?? '—')}</td>
                    <td><span className={`badge ${done ? 'ok' : 'warn'}`}>{status}</span></td>
                    <td>
                      {!done && (
                        <form action={confirmInfraAction} style={{ display: 'inline' }}>
                          <input type="hidden" name="id" value={id} />
                          <button className="btn-ok" type="submit">I created this</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
