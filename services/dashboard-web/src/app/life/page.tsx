import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { HouseholdMap } from '@/components/domains/HouseholdMap';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Family & Home room. Was `/me/reality` (shared,
 *  generic, with `health`) — see docs/living-command-universe-vision.md §A.4. */
export const dynamic = 'force-dynamic';

export default async function LifeDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'life');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const items: DomainRoomItem[] = data.life.items.map((l) => ({
    label: String(l.title ?? ''),
    detail: `${String(l.domain ?? '')} · ${String(l.itemType ?? '')}${l.dueDate ? ` · due ${String(l.dueDate)}` : ''} · ${String(l.status ?? '')}`,
    tone: l.importance === 'high' ? 'warn' : l.status === 'active' ? 'ok' : 'neutral',
    timestamp: typeof l.createdAt === 'string' ? l.createdAt : null,
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<HouseholdMap zone={zone} />}
      items={items}
      itemsLabel="All family & home items"
      deeperLinks={DEEPER_LINKS.life}
      itemsEmptyHint="Ingest kind=life_item (domain: family|home|relationship|household, title, importance, dueDate) to map responsibilities and concerns."
    />
  );
}
