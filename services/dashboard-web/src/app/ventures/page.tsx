import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { VentureBoard } from '@/components/domains/VentureBoard';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Ventures & Projects room. Was `/me/projects`
 *  directly (already reasonably dedicated) — now comparable in structure
 *  to the other eight rooms, with `/me/projects` kept as the deeper link. */
export const dynamic = 'force-dynamic';

export default async function VenturesDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'ventures');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const items: DomainRoomItem[] = data.ventures.projects.map((p) => ({
    label: String(p.title ?? ''),
    detail: `income potential: ${String(p.incomePotential ?? 'unknown')} · ${Array.isArray(p.linkedGoalIds) ? p.linkedGoalIds.length : 0} goal link(s) · ${String(p.status ?? '')}`,
    tone: p.status !== 'active' ? 'neutral' : p.incomePotential === 'high' ? 'ok' : 'neutral',
    timestamp: typeof p.createdAt === 'string' ? p.createdAt : null,
    href: '/me/projects',
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<VentureBoard zone={zone} />}
      items={items}
      itemsLabel="All ventures & projects"
      deeperLinks={DEEPER_LINKS.ventures}
      itemsEmptyHint="Ingest kind=project with incomePotential + linkedGoalIds."
    />
  );
}
