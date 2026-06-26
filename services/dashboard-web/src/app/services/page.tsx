import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const services = (await gateway.services()) as Array<Record<string, unknown>> | null;
  const list = services ?? [];
  return (
    <>
      <PageHeader title="Services" subtitle="Every service known to the registry — type, version, and deployment status." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="⬡" title="No services registered yet" hint="Start the service-registry and boot services so they self-register." /></div>
      ) : (
        <div className="card-grid">
          {list.map((s, i) => (
            <div className="card" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <b style={{ fontSize: 14.5 }}>{String(s.serviceName ?? s.serviceId)}</b>
                <StatusPill status={String(s.deploymentStatus ?? 'registered')} />
              </div>
              <div className="m" style={{ fontSize: 12.5, marginBottom: 10, wordBreak: 'break-all' }}>{String(s.domain ?? '—')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="chip">{String(s.serviceType ?? 'service')}</span>
                <span className="chip">v{String(s.version ?? '0.0.0')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
