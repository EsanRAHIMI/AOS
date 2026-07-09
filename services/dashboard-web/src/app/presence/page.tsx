import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { PresenceBadges } from '@/components/domains/PresenceBadges';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Presence & Channels room. Was `/settings/connectors`
 *  directly — kept as the deeper consent-management link. */
export const dynamic = 'force-dynamic';

export default async function PresenceDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'presence');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const items: DomainRoomItem[] = data.presence.connectors.map((c) => ({
    label: c.connectorType,
    detail: `status: ${c.status}`,
    tone: c.status === 'connected' ? 'ok' : 'neutral',
    timestamp: c.createdAt ?? null,
    href: '/settings/connectors',
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<PresenceBadges zone={zone} />}
      items={items}
      itemsLabel="All connected/registered channels"
      deeperLinks={DEEPER_LINKS.presence}
      itemsEmptyHint="Grant a read-only consent (POST /v1/consents, e.g. connectorType “linkedin”), then register the connector account. No writes, ever, without approval phases."
    />
  );
}
