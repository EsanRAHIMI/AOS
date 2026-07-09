'use client';
import Link from 'next/link';
import { useUniverse } from './UniverseProvider';
import { UniverseZone, type ZoneData } from './UniverseZone';
import { BodyMap, type BodyMetric } from './BodyMap';
import { FinanceFlow } from './domains/FinanceFlow';
import { SystemPulse } from './domains/SystemPulse';
import { PresenceBadges } from './domains/PresenceBadges';
import { PriorityStack } from './domains/PriorityStack';
import { HouseholdMap } from './domains/HouseholdMap';
import { VentureBoard } from './domains/VentureBoard';
import { SkillLanes } from './domains/SkillLanes';
import { OpportunityRadar } from './domains/OpportunityRadar';
import { LiveEvents } from './LiveEvents';
import { ActiveOperationsPanel } from './ActiveOperationsPanel';
import { PresenceBar } from './PresenceBar';
import { FocusRow } from './FocusRow';
import { JarvisSuggestions } from './JarvisSuggestions';
import { buildFocusItems } from '@/lib/focus';

/**
 * Phase AF.4 — the live, client-driven half of the Command Universe
 * homepage. Everything here used to be static JSX in the server-rendered
 * `page.tsx`, fetched once per navigation with no way to update itself —
 * the root cause of "must refresh the whole page to see changes". This
 * component reads from `UniverseProvider` (seeded server-side for a fast
 * first paint, refreshable client-side afterward) instead of props, so a
 * successful domain action or a relevant background event can update just
 * the affected zones — see `UniverseProvider.refresh()`.
 *
 * `ctx`/`session`-derived bits (safe mode banner text, consent count, owner
 * badge) are intentionally still static props from the initial server
 * fetch — they change far less often than domain data and aren't in the
 * block-invalidation model this phase adds; documented as a known,
 * acceptable gap rather than silently making them look live when they
 * aren't.
 */
export function HomeLive({ session, ctx }: { session: { role: string } | null; ctx: { safeMode?: boolean; activeConsents?: number; governance?: string } | null }) {
  const { zones, actor, generatedAt, suggestedPrompts, systemHealthSummary, briefing, memoryInsights, refreshingBlocks } = useUniverse();
  const z = (id: string): ZoneData | undefined => zones.get(id) as ZoneData | undefined;
  const health = z('health');
  const finance = z('finance');
  const systems = z('systems');
  const presence = z('presence');
  const zoneList = [...zones.values()];
  const live = zoneList.filter((x) => x.status === 'live').length;
  const attention = zoneList.filter((x) => x.status === 'attention').length;
  const pendingApprovals = systemHealthSummary?.pendingApprovals ?? 0;
  const safeMode = systemHealthSummary?.safeMode ?? false;

  const bodyMetrics: BodyMetric[] = (health?.items ?? []).map((it) => ({
    metric: it.label,
    level: /^(\d+(?:\.\d+)?)\/10/.test(it.detail) ? Number(it.detail.split('/')[0]) : null,
    concern: it.tone === 'warn' || it.tone === 'err',
    detail: it.detail,
  }));

  const focusItems = buildFocusItems(
    briefing
      ? { primaryPriority: briefing.primaryPriority, activeBlockers: briefing.activeBlockers, systemWarnings: briefing.systemWarnings, recommendedNextActions: briefing.recommendedNextActions }
      : null,
    pendingApprovals,
  );

  return (
    <>
      {/* Identity Strip — the world state in one line */}
      <div className="card" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 750, letterSpacing: '0.01em' }}>
            {actor?.displayName ?? 'Esan'} — Command Universe
          </div>
          <div className="m" style={{ fontSize: 11.5 }}>
            {live}/9 domains live · {attention ? `${attention} need attention · ` : ''}
            {ctx?.safeMode ? 'safe mode ON · ' : ''}
            {ctx?.activeConsents ?? 0} consent(s) · generated {generatedAt.slice(11, 19)} ·{' '}
            <span title="Global software evolution. Scoped human data.">{ctx?.governance ?? ''}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/operations" className="btn btn-ghost" style={{ fontSize: 12 }}>Engine room</Link>
          <Link href="/me" className="btn btn-ghost" style={{ fontSize: 12 }}>Personal center</Link>
          {session?.role === 'owner' && <span className="badge ok" style={{ alignSelf: 'center' }}>owner</span>}
        </div>
      </div>

      <PresenceBar briefing={briefing} memoryInsights={memoryInsights} />

      <ActiveOperationsPanel />

      {suggestedPrompts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <span className="label" style={{ fontSize: 10, display: 'block', marginBottom: 6 }}>Explore</span>
          <JarvisSuggestions prompts={suggestedPrompts} />
        </div>
      )}

      <FocusRow items={focusItems} />

      {/* The Domain Canvas — every zone renders a real domain-specific
          visual. A block currently mid-refresh gets a subtle opacity dip
          instead of a spinner overlay — visible feedback without visual
          noise, and never a fake "loading" state on a block that isn't
          actually being touched. */}
      <div className="uz-grid" style={{ marginBottom: 14 }}>
        {health && (
          <div style={{ opacity: refreshingBlocks.has('health') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={health} tall>
              <BodyMap metrics={bodyMetrics} />
            </UniverseZone>
          </div>
        )}
        {z('daily') && (
          <div style={{ opacity: refreshingBlocks.has('daily') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={z('daily')!}>
              <PriorityStack zone={z('daily')!} />
            </UniverseZone>
          </div>
        )}
        {z('life') && (
          <div style={{ opacity: refreshingBlocks.has('life') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={z('life')!}>
              <HouseholdMap zone={z('life')!} />
            </UniverseZone>
          </div>
        )}
        {finance && (
          <div style={{ opacity: refreshingBlocks.has('finance') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={finance}>
              <FinanceFlow zone={finance} />
            </UniverseZone>
          </div>
        )}
        {z('ventures') && (
          <div style={{ opacity: refreshingBlocks.has('ventures') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={z('ventures')!}>
              <VentureBoard zone={z('ventures')!} />
            </UniverseZone>
          </div>
        )}
        {z('growth') && (
          <div style={{ opacity: refreshingBlocks.has('growth') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={z('growth')!}>
              <SkillLanes zone={z('growth')!} />
            </UniverseZone>
          </div>
        )}
        {z('opportunities') && (
          <div style={{ opacity: refreshingBlocks.has('opportunities') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={z('opportunities')!}>
              <OpportunityRadar zone={z('opportunities')!} />
            </UniverseZone>
          </div>
        )}
        {systems && (
          <div style={{ opacity: refreshingBlocks.has('systems') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={systems}>
              <SystemPulse zone={systems} safeMode={safeMode} />
            </UniverseZone>
          </div>
        )}
        {presence && (
          <div style={{ opacity: refreshingBlocks.has('channels') ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <UniverseZone zone={presence}>
              <PresenceBadges zone={presence} />
            </UniverseZone>
          </div>
        )}
      </div>

      {/* Live pulse — the kernel is alive under everything. This SSE
          connection is also what drives cross-tab/background-completion
          block invalidation — one connection, two jobs, never a second
          EventSource. Phase AF.4.3 — `LiveEvents` now renders its own card
          (grouped operation feed, reading live-state via `useUniverse()`
          directly) — no separate wrapper card here anymore, which also
          removes the previous duplicated "Live activity" heading. */}
      <LiveEvents />
    </>
  );
}
