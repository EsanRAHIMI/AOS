import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  const rows = (await gateway.monitor()) as Array<Record<string, unknown>> | null;
  const latest = rows?.[0];
  const services = latest && Array.isArray(latest.services) ? (latest.services as Array<Record<string, unknown>>) : [];
  return (
    <>
      <h1 className="h1">Runtime Monitor</h1>
      <p className="sub">Periodic health scans across registered services.</p>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card"><div className="label">Last scan</div><div className="stat" style={{ fontSize: 16 }}>{latest ? timeAgo(String(latest.createdAt)) : '—'}</div></div>
        <div className="card"><div className="label">Healthy</div><div className="stat">{latest ? String(latest.healthyCount) : 0}</div></div>
        <div className="card"><div className="label">Unhealthy</div><div className="stat">{latest ? String(latest.unhealthyCount) : 0}</div></div>
        <div className="card"><div className="label">Scans</div><div className="stat">{rows?.length ?? 0}</div></div>
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Latest service health</div>
        {services.length === 0 ? <div className="empty">No monitor runs yet. The monitor-agent scans on an interval, or trigger monitor_scan.</div> : (
          <table>
            <thead><tr><th>Service</th><th>Domain</th><th>Healthy</th><th>HTTP</th><th>Latency</th></tr></thead>
            <tbody>
              {services.map((s, i) => (
                <tr key={i}>
                  <td>{String(s.serviceName)}</td>
                  <td className="m">{String(s.domain)}</td>
                  <td><span className={`badge ${s.healthy ? 'ok' : 'err'}`}>{s.healthy ? 'up' : 'down'}</span></td>
                  <td className="m">{String(s.httpStatus ?? '—')}</td>
                  <td className="m">{String(s.latencyMs ?? '—')}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
