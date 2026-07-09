import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { SystemPulse } from '@/components/domains/SystemPulse';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated AI Kernel & Systems room. The zone already linked
 *  to the real, comprehensive `/operations` Engine Room — this room gives
 *  it the same comparable front-door structure as the other eight domains,
 *  then deep-links into Engine Room/Events/Services for full management. */
export const dynamic = 'force-dynamic';

export default async function SystemsDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'systems');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const incidentItems: DomainRoomItem[] = data.systems.openIncidents.map((i) => ({
    label: String(i.title ?? i.detail ?? 'incident'),
    detail: `${String(i.severity ?? '')} · ${String(i.status ?? '')}${i.serviceName ? ` · ${String(i.serviceName)}` : ''}`,
    tone: 'err',
    href: '/incidents',
    timestamp: typeof i.createdAt === 'string' ? i.createdAt : null,
  }));
  const eventItems: DomainRoomItem[] = data.systems.recentEventsRaw.map((e) => ({
    label: e.message,
    detail: e.type,
    tone: 'neutral',
    timestamp: e.createdAt,
    href: '/events',
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<SystemPulse zone={zone} safeMode={data.systems.kernel.safeMode} />}
      items={[...incidentItems, ...eventItems]}
      itemsLabel="Open incidents and recent kernel events"
      deeperLinks={DEEPER_LINKS.systems}
      itemsEmptyHint="The self-developing kernel is always live — no open incidents and nothing recent to show right now."
    />
  );
}
