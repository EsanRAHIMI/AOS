import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import Link from 'next/link';
export const dynamic = 'force-dynamic';

/** CIN entity detail — living identity: sections, key, relations, claims. */
export default async function CinEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, graph, claimsAbout, claimsBy] = await Promise.all([
    gateway.cinEntity(id),
    gateway.cinEntityGraph(id),
    gateway.cinClaims({ subjectEntityId: id }),
    gateway.cinClaims({ issuerEntityId: id }),
  ]);
  if (!detail) {
    return (<><h1 className="h1">Entity not found</h1><p className="sub"><Link href="/cin">← CIN overview</Link></p></>);
  }
  const e = detail.entity;
  const sections = Object.entries((e.sections as Record<string, { data: Record<string, unknown>; visibility: string; version: number; updatedAt: string }>) ?? {});
  const relations = graph?.relations ?? [];
  const neighbors = new Map((graph?.neighbors ?? []).map((n) => [String(n.entityId), String(n.displayName || n.name)]));

  return (
    <>
      <h1 className="h1">{String(e.displayName || e.name)}</h1>
      <p className="sub">
        <span className="badge">{String(e.entityType)}</span> {String(e.entityId)} · {String(e.status)} ·{' '}
        created {timeAgo(String(e.createdAt))} · <Link href="/cin">← CIN overview</Link>
      </p>

      <div className="card">
        <h2>Signing key</h2>
        {detail.publicKey ? (
          <p><span className="badge">{detail.publicKey.alg}</span> <code className="m">{detail.publicKey.keyId}</code></p>
        ) : (
          <div className="empty">No active key.</div>
        )}
      </div>

      <div className="card">
        <h2>Living profile sections ({sections.length})</h2>
        {sections.length === 0 ? (
          <div className="empty">No sections yet.</div>
        ) : (
          <table>
            <thead><tr><th>Section</th><th>Visibility</th><th>Version</th><th>Data</th><th>Updated</th></tr></thead>
            <tbody>
              {sections.map(([name, s]) => (
                <tr key={name}>
                  <td><span className="badge">{name}</span></td>
                  <td className="m">{s.visibility}</td>
                  <td className="m">v{s.version}</td>
                  <td className="m">{JSON.stringify(s.data).slice(0, 120)}</td>
                  <td className="m">{timeAgo(String(s.updatedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Relations ({relations.length})</h2>
        {relations.length === 0 ? (
          <div className="empty">No active relations.</div>
        ) : (
          <table>
            <thead><tr><th>Direction</th><th>Type</th><th>With</th><th>Role</th><th>Since</th></tr></thead>
            <tbody>
              {relations.map((r) => {
                const outgoing = String(r.fromEntityId) === id;
                const otherId = outgoing ? String(r.toEntityId) : String(r.fromEntityId);
                return (
                  <tr key={String(r.relationId)}>
                    <td className="m">{outgoing ? '→' : '←'}</td>
                    <td><span className="badge">{String(r.relationType)}</span></td>
                    <td><Link href={`/cin/entities/${otherId}`}>{neighbors.get(otherId) ?? otherId}</Link></td>
                    <td className="m">{String(r.role || '—')}</td>
                    <td className="m">{r.since ? timeAgo(String(r.since)) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Claims about this entity ({(claimsAbout?.claims ?? []).length}) · issued by it ({(claimsBy?.claims ?? []).length})</h2>
        {[...(claimsAbout?.claims ?? []), ...(claimsBy?.claims ?? [])].length === 0 ? (
          <div className="empty">No claims.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Issuer → Subject</th><th>Alg</th><th>Status</th><th>Issued</th></tr></thead>
            <tbody>
              {[...(claimsAbout?.claims ?? []), ...(claimsBy?.claims ?? [])].map((c) => (
                <tr key={String(c.claimId)}>
                  <td><span className="badge">{String(c.claimType)}</span></td>
                  <td className="m">{String(c.issuerEntityId)} → {String(c.subjectEntityId)}</td>
                  <td className="m">{String(c.alg)}</td>
                  <td className="m">{c.revokedAt ? 'REVOKED' : 'active'}</td>
                  <td className="m">{timeAgo(String(c.issuedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
