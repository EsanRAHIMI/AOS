import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import Link from 'next/link';
export const dynamic = 'force-dynamic';

/**
 * CIN — Collective Intelligence Network overview (CIN-1, D-180).
 * The civilizational layer: living entities, verifiable claims, and the
 * tamper-evident ledger with live chain verification.
 */
export default async function CinPage() {
  const [entitiesRes, claimsRes, ledgerRes, chain] = await Promise.all([
    gateway.cinEntities(),
    gateway.cinClaims(),
    gateway.cinLedger(30),
    gateway.cinLedgerVerify(),
  ]);
  const entities = entitiesRes?.entities ?? [];
  const claims = claimsRes?.claims ?? [];
  const records = ledgerRes?.records ?? [];

  return (
    <>
      <h1 className="h1">Collective Intelligence Network</h1>
      <p className="sub">
        Living identities, cryptographically verifiable claims, and the tamper-evident chain —
        the CIN v2 civilizational layer. <Link href="/cin/entities">All entities →</Link>
      </p>

      <div className="card">
        <h2>Trust chain</h2>
        {!chain ? (
          <div className="empty">Ledger unavailable.</div>
        ) : chain.ok ? (
          <p>
            <span className="badge">INTACT</span>{' '}
            {chain.length} chained records · head <code className="m">{chain.headHash ? `${chain.headHash.slice(0, 16)}…` : '—'}</code>
          </p>
        ) : (
          <p>
            <span className="badge">BROKEN</span>{' '}
            at seq {chain.brokenAtSeq}: {chain.reason}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Entities ({entities.length})</h2>
        {entities.length === 0 ? (
          <div className="empty">No entities yet. Run <code className="m">scripts/cin-genesis-seed.mjs</code> to seed the genesis identities (owner, Jarvis, kernel).</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Name</th><th>Status</th><th>Sections</th><th>Created</th></tr></thead>
            <tbody>
              {entities.map((e) => (
                <tr key={String(e.entityId)}>
                  <td><span className="badge">{String(e.entityType)}</span></td>
                  <td><Link href={`/cin/entities/${String(e.entityId)}`}>{String(e.displayName || e.name)}</Link></td>
                  <td className="m">{String(e.status)}</td>
                  <td className="m">{Object.keys((e.sections as Record<string, unknown>) ?? {}).join(', ') || '—'}</td>
                  <td className="m">{timeAgo(String(e.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Verifiable claims ({claims.length})</h2>
        {claims.length === 0 ? (
          <div className="empty">No claims issued yet.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Issuer → Subject</th><th>Alg</th><th>Status</th><th>Issued</th></tr></thead>
            <tbody>
              {claims.map((c) => (
                <tr key={String(c.claimId)}>
                  <td><span className="badge">{String(c.claimType)}</span></td>
                  <td className="m">{String(c.issuerEntityId)} → {String(c.subjectEntityId)}</td>
                  <td className="m">{String(c.alg)}</td>
                  <td className="m">{c.revokedAt ? 'REVOKED' : c.expiresAt && String(c.expiresAt) <= new Date().toISOString() ? 'EXPIRED' : 'active'}</td>
                  <td className="m">{timeAgo(String(c.issuedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Ledger (latest {records.length})</h2>
        {records.length === 0 ? (
          <div className="empty">Ledger is empty.</div>
        ) : (
          <table>
            <thead><tr><th>Seq</th><th>Record</th><th>Ref</th><th>Actor</th><th>Hash</th><th>When</th></tr></thead>
            <tbody>
              {[...records].reverse().map((r) => (
                <tr key={String(r.ledgerId)}>
                  <td className="m">{String(r.seq)}</td>
                  <td><span className="badge">{String(r.recordType)}</span> {String(r.summary)}</td>
                  <td className="m">{String(r.refId)}</td>
                  <td className="m">{String(r.actorEntityId)}</td>
                  <td className="m">{String(r.hash).slice(0, 12)}…</td>
                  <td className="m">{timeAgo(String(r.at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
