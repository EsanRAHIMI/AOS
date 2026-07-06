import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { UniverseZone, type ZoneData } from '@/components/UniverseZone';
import { BodyMap, type BodyMetric } from '@/components/BodyMap';
import { LiveEvents } from '@/components/LiveEvents';

export const dynamic = 'force-dynamic';

/**
 * Phase AC+ — The Command Universe. The living home of AOS: nine life/work/
 * system domains on one operating surface, fed by ONE scope-enforced
 * aggregation contract (/v1/me/universe). Every zone is honest — LIVE only
 * with real data, otherwise a premium setup-ready state that says exactly how
 * to activate it. Jarvis (the Operator Console, bottom right) is summonable
 * from every zone with a contextual command.
 */
export default async function CommandUniversePage() {
  const [session, universe, ctx] = await Promise.all([getSession(), gateway.universe(), gateway.meContext()]);
  const zones = new Map<string, ZoneData>((universe?.zones ?? []).map((z) => [z.zoneId, z as ZoneData]));
  const z = (id: string): ZoneData | undefined => zones.get(id);
  const health = z('health');
  const live = [...zones.values()].filter((x) => x.status === 'live').length;
  const attention = [...zones.values()].filter((x) => x.status === 'attention').length;

  // Body map metrics from the health zone's real items (level parsed from detail).
  const bodyMetrics: BodyMetric[] = (health?.items ?? []).map((it) => ({
    metric: it.label,
    level: /^(\d+(?:\.\d+)?)\/10/.test(it.detail) ? Number(it.detail.split('/')[0]) : null,
    concern: it.tone === 'warn' || it.tone === 'err',
    detail: it.detail,
  }));

  return (
    <>
      {/* Hero strip — the world state in one line */}
      <div className="card" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 750, letterSpacing: '0.01em' }}>
            {universe?.actor.displayName ?? 'Esan'} — Command Universe
          </div>
          <div className="m" style={{ fontSize: 11.5 }}>
            {live}/9 domains live · {attention ? `${attention} need attention · ` : ''}
            {ctx?.safeMode ? 'safe mode ON · ' : ''}
            {ctx?.activeConsents ?? 0} consent(s) · generated {String(universe?.generatedAt ?? '').slice(11, 19)} ·{' '}
            <span title="Global software evolution. Scoped human data.">{ctx?.governance ?? ''}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/operations" className="btn btn-ghost" style={{ fontSize: 12 }}>Engine room</Link>
          <Link href="/me" className="btn btn-ghost" style={{ fontSize: 12 }}>Personal center</Link>
          {session?.role === 'owner' && <span className="badge ok" style={{ alignSelf: 'center' }}>owner</span>}
        </div>
      </div>

      {/* The universe grid */}
      <div className="uz-grid" style={{ marginBottom: 14 }}>
        {health && (
          <UniverseZone zone={health} tall>
            <BodyMap metrics={bodyMetrics} />
          </UniverseZone>
        )}
        {(['daily', 'finance', 'ventures', 'life', 'opportunities', 'growth', 'systems', 'presence'] as const).map((id) => {
          const zone = z(id);
          return zone ? <UniverseZone key={id} zone={zone} /> : null;
        })}
      </div>

      {/* Live pulse — the kernel is alive under everything */}
      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Live pulse — kernel & operator events</div>
        <LiveEvents />
      </div>
    </>
  );
}
