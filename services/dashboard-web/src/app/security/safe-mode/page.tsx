import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { PageHeader, EmptyState } from '@/components/ui';
import { setSafeModeAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function SafeModePage() {
  const [session, safe] = await Promise.all([getSession(), gateway.safeMode()]);
  const enabled = Boolean(safe?.enabled);
  const isOwner = session?.role === 'owner';

  return (
    <>
      <PageHeader title="Safe Mode" subtitle="Emergency kill-switch. When on, the kernel refuses mutation, deploy, repair and governance actions — read, monitor and report only." />

      <div className="card" style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span className="label">Current state</span>
          <span className={`badge ${enabled ? 'warn' : 'ok'}`}>{enabled ? 'SAFE MODE ON' : 'normal operation'}</span>
        </div>
        <p className="m" style={{ fontSize: 13, marginTop: 0 }}>
          {enabled
            ? 'Mutating actions are currently blocked at the gateway and in the dashboard. Reads, monitoring, reports and recommendations continue to work.'
            : 'All actions operate normally, subject to role permissions and approvals.'}
        </p>

        {!isOwner ? (
          <EmptyState icon="🔒" title="Owner only" hint="Only an owner can change safe mode." />
        ) : (
          <form action={setSafeModeAction} className="actions" style={{ marginTop: 6 }}>
            <input type="hidden" name="enabled" value={(!enabled).toString()} />
            <button type="submit" className={`btn ${enabled ? 'btn-ok' : 'btn-err'}`}>
              {enabled ? 'Disable safe mode' : 'Enable safe mode'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
