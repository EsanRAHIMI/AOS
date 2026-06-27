import { gateway } from '@/lib/gateway';
import { confirmInfraAction } from '@/app/actions';
import { PageHeader, EmptyState } from '@/components/ui';
export const dynamic = 'force-dynamic';

export default async function InfraPage() {
  const rows = (await gateway.infrastructure()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Infrastructure Requests" subtitle="Exact infra to create in Dokploy, then confirm. The system never assumes host control." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="⬡" title="No infrastructure requests" hint="When the kernel needs a new service or domain, the exact spec appears here as a checklist." /></div>
      ) : (
        <div className="card-grid">
          {list.map((r, i) => {
            const d = (r.dokploy ?? {}) as Record<string, unknown>;
            const id = String(r.requestId);
            const status = String(r.status);
            const done = status === 'fulfilled';
            return (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <b style={{ fontSize: 14.5 }}>{String(r.serviceName)}</b>
                  <span className={`badge ${done ? 'ok' : 'warn'}`}>{status}</span>
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', margin: '0 0 14px', fontSize: 13 }}>
                  <dt className="m">Domain</dt><dd style={{ margin: 0, wordBreak: 'break-all' }}>{String(d.domain ?? '—')}</dd>
                  <dt className="m">Port</dt><dd style={{ margin: 0 }}>{String(d.port ?? '—')}</dd>
                  <dt className="m">Root dir</dt><dd style={{ margin: 0, wordBreak: 'break-all' }}>{String(d.rootDirectory ?? '—')}</dd>
                </dl>
                {!done && (
                  <form action={confirmInfraAction}>
                    <input type="hidden" name="id" value={id} />
                    <button className="btn btn-ok" type="submit" style={{ width: '100%' }}>I created this in Dokploy</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
