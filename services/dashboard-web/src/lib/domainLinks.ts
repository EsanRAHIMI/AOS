/**
 * Phase AF.1 Step 7 — AI-guided screen interaction, safe foundation.
 *
 * Maps a Jarvis `intentCategory` (already returned by `/v1/operator/command`
 * since Phase AD — real, live classification, not invented here) to the
 * real Command Universe zone it concerns. Used to render a "Related: Zone →"
 * domain-reference chip under a Jarvis reply, so a conversation can point
 * back at the part of the universe it's about instead of only living as
 * chat text. Pure data — no fetching, no React.
 *
 * Phase AF.2 Step 5: every zone now has a real, custom visual on the
 * homepage (`/#zone-<id>`, an anchor `UniverseZone` renders and
 * scrolls/highlights itself into view on match — see UniverseZone.tsx),
 * so domain links now point there instead of at the still-generic
 * secondary pages under /me/*. `approvals_tasks` is the one exception: the
 * Approvals center is a real, distinct workflow page, not a Domain Canvas
 * zone, so it correctly keeps its own route.
 */

export interface DomainLink { title: string; href: string }

const CATEGORY_TO_DOMAIN: Record<string, DomainLink> = {
  system_status: { title: 'AI Kernel & Systems', href: '/#zone-systems' },
  personal_life_planning: { title: 'Today & Priorities', href: '/#zone-daily' },
  business_project: { title: 'Ventures & Projects', href: '/#zone-ventures' },
  finance_ops: { title: 'Money & Commitments', href: '/#zone-finance' },
  schedule_calendar: { title: 'Today & Priorities', href: '/#zone-daily' },
  email_communication: { title: 'Presence & Channels', href: '/#zone-presence' },
  research_opportunities: { title: 'Opportunity Radar', href: '/#zone-opportunities' },
  code_development: { title: 'AI Kernel & Systems', href: '/#zone-systems' },
  approvals_tasks: { title: 'Approvals', href: '/approvals' },
  memory_profile_capture: { title: 'Body & Health', href: '/#zone-health' },
  meta_self_assessment: { title: 'AI Kernel & Systems', href: '/#zone-systems' },
  // general_conversation intentionally has no domain — not every reply
  // concerns a specific part of the universe, and a chip pointing nowhere
  // meaningful would be exactly the "gimmicky" pattern this phase forbids.
};

export function domainLinkFor(intentCategory: string): DomainLink | null {
  return CATEGORY_TO_DOMAIN[intentCategory] ?? null;
}
