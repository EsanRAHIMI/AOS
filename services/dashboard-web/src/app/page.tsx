import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { getBriefingAction } from '@/app/jarvis/actions';
import { UniverseZone, type ZoneData } from '@/components/UniverseZone';
import { BodyMap, type BodyMetric } from '@/components/BodyMap';
import { FinanceFlow } from '@/components/domains/FinanceFlow';
import { SystemPulse } from '@/components/domains/SystemPulse';
import { PresenceBadges } from '@/components/domains/PresenceBadges';
import { PriorityStack } from '@/components/domains/PriorityStack';
import { HouseholdMap } from '@/components/domains/HouseholdMap';
import { VentureBoard } from '@/components/domains/VentureBoard';
import { SkillLanes } from '@/components/domains/SkillLanes';
import { OpportunityRadar } from '@/components/domains/OpportunityRadar';
import { LiveEvents } from '@/components/LiveEvents';
import { PresenceBar } from '@/components/PresenceBar';
import { FocusRow } from '@/components/FocusRow';
import { JarvisSuggestions } from '@/components/JarvisSuggestions';
import { buildFocusItems } from '@/lib/focus';

export const dynamic = 'force-dynamic';

/**
 * Phase AF.1 — The Command Universe, foundation of the Living AI Government
 * vision (docs/living-command-universe-vision.md). Structural shell:
 * Identity Strip → Jarvis Presence Bar (real /v1/jarvis/briefing data) →
 * Focus Row (top 1–3 things that need attention, priority-first) → Domain
 * Canvas (all nine zones now render a real domain-specific visual, Phase
 * AF.2) → live pulse. Jarvis (the persistent shell, `OperatorConsole`,
 * mounted at the root layout) is summonable from every zone with a
 * contextual command, and every zone is a real anchor (`#zone-<id>`) a
 * Jarvis reply's domain-link chip can point straight at.
 */
export default async function CommandUniversePage() {
  const [session, universe, ctx, briefing] = await Promise.all([
    getSession(),
    gateway.universe(),
    gateway.meContext(),
    getBriefingAction(),
  ]);
  const zones = new Map<string, ZoneData>((universe?.zones ?? []).map((z) => [z.zoneId, z as ZoneData]));
  const z = (id: string): ZoneData | undefined => zones.get(id);
  const health = z('health');
  const finance = z('finance');
  const systems = z('systems');
  const presence = z('presence');
  const live = [...zones.values()].filter((x) => x.status === 'live').length;
  const attention = [...zones.values()].filter((x) => x.status === 'attention').length;
  const pendingApprovals = universe?.systemHealthSummary.pendingApprovals ?? 0;
  const safeMode = universe?.systemHealthSummary.safeMode ?? false;

  // Body map metrics from the health zone's real items (level parsed from detail).
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

      {/* Phase AF.1 Step 2 — Jarvis Presence Bar: real briefing, not a
          flattened sentence. */}
      <PresenceBar briefing={briefing} memoryInsights={universe?.memoryInsights} />

      {/* Phase AD's zone-status-derived quick prompts — distinct from the
          briefing's authoritative recommendations above: these surface
          whichever zone most needs attention right now, one click into a
          contextual Jarvis command. Kept small and clearly secondary so it
          never competes with the Presence Bar for attention. */}
      {universe && universe.suggestedPrompts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <span className="label" style={{ fontSize: 10, display: 'block', marginBottom: 6 }}>Explore</span>
          <JarvisSuggestions prompts={universe.suggestedPrompts} />
        </div>
      )}

      {/* Phase AF.1 Step 3 — Focus Row: what actually needs attention now,
          priority-first. Renders nothing when there is genuinely nothing to
          focus on (never a fake placeholder row). */}
      <FocusRow items={focusItems} />

      {/* The Domain Canvas — Phase AF.2: all nine zones now render a real,
          domain-specific visual (src/lib/domainCanvas.ts is the checkable
          manifest); none fall back to the generic bullet list anymore. */}
      <div className="uz-grid" style={{ marginBottom: 14 }}>
        {health && (
          <UniverseZone zone={health} tall>
            <BodyMap metrics={bodyMetrics} />
          </UniverseZone>
        )}
        {z('daily') && (
          <UniverseZone zone={z('daily')!}>
            <PriorityStack zone={z('daily')!} />
          </UniverseZone>
        )}
        {z('life') && (
          <UniverseZone zone={z('life')!}>
            <HouseholdMap zone={z('life')!} />
          </UniverseZone>
        )}
        {finance && (
          <UniverseZone zone={finance}>
            <FinanceFlow zone={finance} />
          </UniverseZone>
        )}
        {z('ventures') && (
          <UniverseZone zone={z('ventures')!}>
            <VentureBoard zone={z('ventures')!} />
          </UniverseZone>
        )}
        {z('growth') && (
          <UniverseZone zone={z('growth')!}>
            <SkillLanes zone={z('growth')!} />
          </UniverseZone>
        )}
        {z('opportunities') && (
          <UniverseZone zone={z('opportunities')!}>
            <OpportunityRadar zone={z('opportunities')!} />
          </UniverseZone>
        )}
        {systems && (
          <UniverseZone zone={systems}>
            <SystemPulse zone={systems} safeMode={safeMode} />
          </UniverseZone>
        )}
        {presence && (
          <UniverseZone zone={presence}>
            <PresenceBadges zone={presence} />
          </UniverseZone>
        )}
      </div>

      {/* Live pulse — the kernel is alive under everything */}
      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Live pulse — kernel & operator events</div>
        <LiveEvents />
      </div>
    </>
  );
}
