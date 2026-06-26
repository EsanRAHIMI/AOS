import Link from 'next/link';
import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function GovernancePage() {
  const [profiles, reviews, proposals, audits] = await Promise.all([gateway.scoringProfiles(), gateway.outcomeReviews(), gateway.scoringProposals(), gateway.auditLogs()]);
  const profs = (profiles ?? []) as Array<Record<string, unknown>>;
  const active = profs.find((p) => p.status === 'active');
  const props = (proposals ?? []) as Array<Record<string, unknown>>;
  const pending = props.filter((p) => p.status === 'waiting_approval').length;
  return (
    <>
      <h1 className="h1">Governance</h1>
      <p className="sub">How the kernel governs its own evolution — learning under approval, versioned and audited.</p>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card"><div className="label">Active scoring profile</div><div className="stat">v{String(active?.version ?? 1)}</div></div>
        <div className="card"><div className="label">Outcome reviews</div><div className="stat">{(reviews ?? []).length}</div></div>
        <div className="card"><div className="label">Pending scoring proposals</div><div className="stat">{pending}</div></div>
        <div className="card"><div className="label">Audit entries</div><div className="stat">{(audits ?? []).length}</div></div>
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Governance areas</div>
        <p className="sub" style={{ margin: 0 }}>
          <Link href="/outcome-reviews">Outcome reviews</Link> · <Link href="/scoring-profiles">Scoring profiles</Link> ·{' '}
          <Link href="/scoring-change-proposals">Scoring proposals</Link> · <Link href="/policy-rules">Policy rules</Link> ·{' '}
          <Link href="/policy-change-proposals">Policy proposals</Link> · <Link href="/rbac">RBAC</Link> · <Link href="/audit-logs">Audit logs</Link>
        </p>
      </div>
    </>
  );
}
