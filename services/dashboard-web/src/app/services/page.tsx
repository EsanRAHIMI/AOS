import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const services = (await gateway.services()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Services</h1>
      <p className="sub">All services known to the registry.</p>
      <div className="card">
        {!services || services.length === 0 ? (
          <div className="empty">No services registered yet. Start the service-registry and boot services.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Type</th><th>Version</th><th>Domain</th><th>Status</th></tr></thead>
            <tbody>
              {services.map((s, i) => (
                <tr key={i}>
                  <td>{String(s.serviceName ?? s.serviceId)}</td>
                  <td>{String(s.serviceType ?? '—')}</td>
                  <td>{String(s.version ?? '—')}</td>
                  <td className="m">{String(s.domain ?? '—')}</td>
                  <td><span className="badge ok">{String(s.deploymentStatus ?? 'registered')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
