import { gateway } from '@/lib/gateway';
import { LiveEvents } from '@/components/LiveEvents';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [status, services, approvals] = await Promise.all([
    gateway.systemStatus(),
    gateway.services(),
    gateway.approvals(),
  ]);
  const serviceCount = Array.isArray(services) ? services.length : 0;

  return (
    <>
      <h1 className="h1">Overview</h1>
      <p className="sub">Real-time state of the autonomous factory kernel.</p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="label">Registered services</div>
          <div className="stat">{serviceCount}</div>
        </div>
        <div className="card">
          <div className="label">Tasks</div>
          <div className="stat">{status?.taskCount ?? 0}</div>
        </div>
        <div className="card">
          <div className="label">Pending approvals</div>
          <div className="stat">{status?.pendingApprovals ?? (Array.isArray(approvals) ? approvals.length : 0)}</div>
        </div>
        <div className="card">
          <div className="label">Environment</div>
          <div className="stat" style={{ fontSize: 18 }}>{status?.env ?? 'unknown'}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <LiveEvents />
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>System</div>
          {status ? (
            <p className="sub" style={{ margin: 0 }}>Gateway reachable. All reads proxy through gateway-api with the admin token.</p>
          ) : (
            <p className="empty">Gateway unreachable. Start gateway-api and set FACTORY_API_URL / FACTORY_ADMIN_TOKEN.</p>
          )}
        </div>
      </div>
    </>
  );
}
