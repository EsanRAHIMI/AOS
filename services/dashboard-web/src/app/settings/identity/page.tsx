import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Phase AA — Identity: who is acting, in which tenant, with which roles.
 *  Governance rule shown to every user: global software evolution, scoped
 *  human data. */
export default async function IdentityPage() {
  const [ctx, profile, goals, memories] = await Promise.all([
    gateway.meContext(),
    gateway.meProfile(),
    gateway.meGoals() as Promise<Array<Record<string, unknown>> | null>,
    gateway.meMemoriesScoped() as Promise<Array<Record<string, unknown>> | null>,
  ]);
  const gs = goals ?? [];
  const mems = memories ?? [];
  return (
    <>
      <PageHeader title="Identity & Scope" subtitle={ctx?.governance ?? 'Global software evolution. Scoped human data.'} actions={<Link href="/settings/access-log" className="btn btn-ghost">Access log</Link>} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Actor" value={ctx?.actor.displayName ?? '—'} hint={`${ctx?.actor.actorId ?? ''} · ${ctx?.actor.isOwner ? 'OWNER / platform governor' : ctx?.actor.roles.join(', ') ?? ''}`} tone={ctx?.actor.isOwner ? 'ok' : undefined} />
        <MetricCard label="Active tenant" value={ctx?.tenant?.name ?? '—'} hint={`${ctx?.tenant?.tenantId ?? ''} (${ctx?.tenant?.kind ?? ''})`} />
        <MetricCard label="Active scope" value={String(ctx?.activeScope ?? 'user')} hint="user data is private and isolated" />
        <MetricCard label="Safe mode" value={ctx?.safeMode ? 'ON' : 'off'} tone={ctx?.safeMode ? 'warn' : 'ok'} />
      </div>
      <div className="grid cols-2" style={{ gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Profile</div>
          {profile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <div><span className="m">Display name&nbsp;&nbsp;</span>{String(profile.displayName ?? '')}</div>
              <div><span className="m">User id&nbsp;&nbsp;</span>{String(profile.userId ?? '')}</div>
              <div><span className="m">Default tenant&nbsp;&nbsp;</span>{String(profile.defaultTenantId ?? '')}</div>
              <div><span className="m">Locale / TZ&nbsp;&nbsp;</span>{String(profile.locale ?? '')} · {String(profile.timezone ?? '')}</div>
              <div><span className="m">Status&nbsp;&nbsp;</span><StatusPill status={String(profile.status ?? 'active')} /></div>
            </div>
          ) : <EmptyState icon="·" title="Profile unavailable" hint="The gateway could not resolve your identity." />}
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Goals ({gs.length} active) · <Link href="/settings/consents">consents</Link></div>
          {gs.length === 0 ? (
            <EmptyState icon="·" title="No goals recorded" hint="Goals power the personal briefing. Add them via the operator (“plan my week”) or POST /v1/me/goals." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {gs.slice(0, 8).map((g, i) => (
                <div key={i} className="glass" style={{ padding: 8, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                  <span>{String(g.title)}</span>
                  <span className="m">{String(g.horizon)} · {String(g.priority)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Private scoped memories ({mems.length})</div>
        {mems.length === 0 ? (
          <EmptyState icon="·" title="No private memories yet" hint="User-scoped memories are visible only to you. Denied cross-user reads appear in the access log." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mems.slice(0, 10).map((m, i) => (
              <div key={i} className="glass" style={{ padding: 8, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                <span>{String(m.content).slice(0, 120)}</span>
                <span className="badge ok">{String(m.kind)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
