import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const services = (await gateway.services()) as Array<Record<string, unknown>> | null;
  const agents = (services ?? []).filter((s) => s.serviceType === 'agent');
  return (
    <>
      <h1 className="h1">Agents</h1>
      <p className="sub">Independent agent services and their declared capabilities.</p>
      <div className="card">
        {agents.length === 0 ? (
          <div className="empty">No agents registered yet.</div>
        ) : (
          <table>
            <thead><tr><th>Agent</th><th>Capabilities</th><th>Domain</th></tr></thead>
            <tbody>
              {agents.map((a, i) => (
                <tr key={i}>
                  <td>{String(a.serviceName ?? a.serviceId)}</td>
                  <td className="m">{Array.isArray(a.capabilities) ? (a.capabilities as string[]).join(', ') : '—'}</td>
                  <td className="m">{String(a.domain ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
