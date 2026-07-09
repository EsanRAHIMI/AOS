import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { OpportunityRadar } from '@/components/domains/OpportunityRadar';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Opportunity Radar room. `/me/opportunities`
 *  already existed for this domain specifically — kept as the deeper
 *  management link (accept/reject/follow-up), while this room gives
 *  Opportunity Radar the same front-door structure as the other eight. */
export const dynamic = 'force-dynamic';

export default async function OpportunitiesDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'opportunities');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const items: DomainRoomItem[] = data.opportunities.ranked.map((o) => ({
    label: String(o.title ?? ''),
    detail: `${String(o.category ?? '')} · value ${String(o.valueScore ?? '')} · confidence ${String(o.confidence ?? '')} · ${String(o.status ?? '')}`,
    tone: o.status === 'accepted' || o.status === 'in_progress' ? 'ok' : o.status === 'rejected' ? 'neutral' : 'neutral',
    href: '/me/opportunities',
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<OpportunityRadar zone={zone} />}
      items={items}
      itemsLabel="All ranked opportunities"
      deeperLinks={DEEPER_LINKS.opportunities}
      itemsEmptyHint="Ingest opportunity candidates or accept AOS-proposed ones; real market research arrives with the research provider phase."
    />
  );
}
