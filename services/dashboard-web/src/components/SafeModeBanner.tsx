import Link from 'next/link';

/** Persistent banner shown across the app while safe mode blocks mutations. */
export function SafeModeBanner({ enabled, role }: { enabled: boolean; role: string }) {
  if (!enabled) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        margin: '0 0 18px', padding: '10px 14px', borderRadius: 'var(--r)',
        background: 'rgba(255, 193, 77, 0.12)', border: '1px solid rgba(255, 193, 77, 0.4)', color: 'var(--warn)',
      }}
    >
      <span style={{ fontWeight: 700 }}>⚠ Safe mode active</span>
      <span style={{ color: 'var(--text)', fontSize: 13 }}>Mutation, deploy, repair and governance actions are disabled — read, monitor and report only.</span>
      {role === 'owner' && <Link href="/security/safe-mode" className="chip" style={{ marginLeft: 'auto' }}>Manage</Link>}
    </div>
  );
}
