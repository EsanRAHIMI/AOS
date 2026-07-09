import type { ZoneId } from './domainCanvas';

/**
 * Phase AF.5 — "Command Universe follow-through." Every zone's `href` used
 * to point at a generic or mismatched page (health → /me/reality, same page
 * as life; finance → /me/opportunities; see
 * docs/living-command-universe-vision.md Section A.4). Each zone now has its
 * own dedicated room at `/<zoneId>` (see `services/dashboard-web/src/app/
 * <zoneId>/page.tsx`, all built on the shared `DomainRoom` layout — same
 * structure for all nine, so no domain feels like an afterthought next to
 * another).
 *
 * A dedicated room is not a replacement for the richer, pre-existing
 * `/me/*`, `/operations`, or `/settings/*` pages that already do deep
 * CRUD-style management for some domains — it is the comparable front door
 * for ALL nine, and it links onward to whichever deeper page already exists
 * for that specific domain. Domains with no pre-existing deep page (life,
 * finance, daily, growth beyond resume) rely on the room itself showing the
 * complete record list, not a link to a page that doesn't exist.
 */
export interface DeeperLink { label: string; href: string; description: string }

export const DEEPER_LINKS: Record<ZoneId, DeeperLink[]> = {
  health: [
    { label: 'Personal Reality graph', href: '/me/reality', description: 'Full reality graph: profile, assets, systems, risks — health states feed into missing-data detection here.' },
  ],
  daily: [
    { label: 'Personal Command Center', href: '/me', description: 'Accept, reject, or complete every ranked next-best-action, not just today’s top picks.' },
    { label: 'Approvals', href: '/approvals', description: 'Decide any pending approval blocking execution.' },
  ],
  life: [
    { label: 'Personal Reality graph', href: '/me/reality', description: 'Full reality graph and missing-data detection — life items feed the same graph as health.' },
  ],
  finance: [
    { label: 'Goals', href: '/me/goals', description: 'Financial goals and how they link to income opportunities.' },
  ],
  ventures: [
    { label: 'Projects', href: '/me/projects', description: 'Full project, system, and asset inventory behind every venture.' },
  ],
  growth: [
    { label: 'Resume intelligence', href: '/me/resume', description: 'Verified facts vs. claims vs. inferred suggestions — never invents credentials.' },
    { label: 'Goals', href: '/me/goals', description: 'Learning goals and how tracks link back to them.' },
  ],
  opportunities: [
    { label: 'Opportunity Radar (manage)', href: '/me/opportunities', description: 'Accept, reject, or follow up on every ranked opportunity, not just the top ones.' },
  ],
  systems: [
    { label: 'Engine Room (Mission Control)', href: '/operations', description: 'Full kernel operations console: tasks, agents, services, incidents, approvals.' },
    { label: 'Events', href: '/events', description: 'Live system event stream.' },
    { label: 'Services', href: '/services', description: 'Registered service catalog and health.' },
  ],
  presence: [
    { label: 'Connector settings', href: '/settings/connectors', description: 'Grant or revoke read-only consent for a channel connector.' },
  ],
};
