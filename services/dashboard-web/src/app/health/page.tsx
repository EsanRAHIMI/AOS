import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { BodyMap, type BodyMetric } from '@/components/BodyMap';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Body & Health room. Was `/me/reality` (shared,
 *  generic, with `life`) — see docs/living-command-universe-vision.md §A.4. */
export const dynamic = 'force-dynamic';

export default async function HealthDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'health');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const bodyMetrics: BodyMetric[] = data.health.states.map((s) => ({
    metric: String(s.metric),
    level: typeof s.level === 'number' ? s.level : null,
    concern: Boolean(s.concern),
    detail: s.value ? String(s.value) : String(s.note ?? ''),
  }));

  const items: DomainRoomItem[] = data.health.states.map((s) => ({
    label: String(s.metric),
    detail: [typeof s.level === 'number' ? `${s.level}/10` : null, s.value ? String(s.value) : null, s.note ? String(s.note) : null].filter(Boolean).join(' — '),
    tone: s.concern ? 'warn' : 'ok',
    timestamp: typeof s.createdAt === 'string' ? s.createdAt : null,
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<BodyMap metrics={bodyMetrics} />}
      items={items}
      itemsLabel="All health reports"
      deeperLinks={DEEPER_LINKS.health}
      itemsEmptyHint="Report a state: ingest kind=health_state (metric, level 0–10, note)."
    />
  );
}
