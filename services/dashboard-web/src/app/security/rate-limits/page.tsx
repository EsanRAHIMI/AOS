import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function RateLimitsPage() {
  const data = await gateway.rateLimits();
  const buckets = data?.buckets ?? [];
  return (
    <>
      <PageHeader title="Rate Limits" subtitle="Active in-memory rate-limit windows on login, task creation, approvals, and activations. Replaceable with Redis later." />
      {buckets.length === 0 ? (
        <div className="card"><EmptyState icon="⏱" title="No active rate-limit windows" hint="Buckets appear here as mutation traffic arrives, then expire automatically." /></div>
      ) : (
        <div className="card-grid">
          {buckets.map((b, i) => (
            <div className="card" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <b style={{ fontSize: 13.5, wordBreak: 'break-all' }}>{b.key}</b>
                <span className="badge warn">{b.count}</span>
              </div>
              <div className="m" style={{ fontSize: 12.5, marginTop: 6 }}>window resets {timeAgo(b.resetAt)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
