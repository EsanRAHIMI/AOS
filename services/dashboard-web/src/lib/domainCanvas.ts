/**
 * Phase AF.2 — the Domain Canvas manifest. Single source of truth for which
 * of the nine Command Universe zones has a real, domain-specific visual
 * renderer (as opposed to the generic bullet-list fallback in
 * `UniverseZone.tsx`). Pure data, no React — importable by the smoke test
 * so "every zone has a domain-specific renderer" is a checkable fact, not a
 * claim.
 */

export const ZONE_IDS = ['health', 'daily', 'life', 'finance', 'ventures', 'growth', 'opportunities', 'systems', 'presence'] as const;
export type ZoneId = typeof ZONE_IDS[number];

/** zoneId → the component file (relative to src/components) that renders
 *  it. Updated only when a zone actually gains a real renderer wired into
 *  page.tsx — never speculatively. */
export const DOMAIN_RENDERERS: Record<ZoneId, string> = {
  health: 'BodyMap.tsx',
  daily: 'domains/PriorityStack.tsx',
  life: 'domains/HouseholdMap.tsx',
  finance: 'domains/FinanceFlow.tsx',
  ventures: 'domains/VentureBoard.tsx',
  growth: 'domains/SkillLanes.tsx',
  opportunities: 'domains/OpportunityRadar.tsx',
  systems: 'domains/SystemPulse.tsx',
  presence: 'domains/PresenceBadges.tsx',
};

export function hasDomainRenderer(zoneId: string): boolean {
  return Object.prototype.hasOwnProperty.call(DOMAIN_RENDERERS, zoneId);
}
