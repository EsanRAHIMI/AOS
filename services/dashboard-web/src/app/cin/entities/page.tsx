import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import Link from 'next/link';
export const dynamic = 'force-dynamic';

/** CIN entities index (CIN-1, D-180) — all living identities by type. */
export default async function CinEntitiesPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const sp = await searchParams;
  const res = await gateway.cinEntities({ entityType: sp.type, q: sp.q });
  const entities = res?.entities ?? [];
  const types = ['person', 'organization', 'org_unit', 'city', 'region', 'government', 'ai_agent', 'robot', 'device', 'service'];

  return (
    <>
      <h1 className="h1">CIN Entities</h1>
      <p className="sub">
        Every living identity in the network. Filter:{' '}
        <Link href="/cin/entities">all</Link>
        {types.map((t) => (<span key={t}> · <Link href={`/cin/entities?type=${t}`}>{t}</Link></span>))}
      </p>
      <div className="card">
        {entities.length === 0 ? (
          <div className="empty">No entities{sp.type ? ` of type ${sp.type}` : ''} yet.</div>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Name</th><th>Status</th><th>Tags</th><th>Created</th></tr></thead>
            <tbody>
              {entities.map((e) => (
                <tr key={String(e.entityId)}>
                  <td><span className="badge">{String(e.entityType)}</span></td>
                  <td><Link href={`/cin/entities/${String(e.entityId)}`}>{String(e.displayName || e.name)}</Link></td>
                  <td className="m">{String(e.status)}</td>
                  <td className="m">{((e.tags as string[]) ?? []).join(', ') || '—'}</td>
                  <td className="m">{timeAgo(String(e.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
