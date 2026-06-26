import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const services = (await gateway.services()) as Array<Record<string, unknown>> | null;
  const agents = (services ?? []).filter((s) => s.serviceType === 'agent');
  return (
    <>
      <PageHeader title="Agents" subtitle="Independent agent services and the capabilities each one declares to the kernel." />
      {agents.length === 0 ? (
        <div className="card"><EmptyState icon="◆" title="No agents registered yet" hint="Boot the agent services and they will self-register with the registry." /></div>
      ) : (
        <div className="card-grid">
          {agents.map((a, i) => {
            const caps = Array.isArray(a.capabilities) ? (a.capabilities as string[]) : [];
            return (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <b style={{ fontSize: 14.5 }}>{String(a.serviceName ?? a.serviceId)}</b>
                  <span className="badge ok">agent</span>
                </div>
                <div className="m" style={{ fontSize: 12.5, marginBottom: 10 }}>{String(a.domain ?? '—')}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {caps.length === 0 ? <span className="m" style={{ fontSize: 12.5 }}>No capabilities declared</span> : caps.map((c) => <span className="chip" key={c}>{c}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
