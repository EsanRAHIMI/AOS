import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { PriorityStack } from '@/components/domains/PriorityStack';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Today & Priorities room. Was `/me` (the broader
 *  Personal Command Center — kept as the "go deeper" link, not replaced). */
export const dynamic = 'force-dynamic';

export default async function DailyDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'daily');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const items: DomainRoomItem[] = data.daily.allActions.map((a) => ({
    label: String(a.title ?? ''),
    detail: `${String(a.category ?? '')} · score ${String(a.priorityScore ?? '')} · ${String(a.status ?? '')}`,
    tone: a.status === 'accepted' || a.status === 'completed' ? 'ok' : a.status === 'rejected' ? 'neutral' : a.category === 'risk' ? 'warn' : 'neutral',
    timestamp: typeof a.createdAt === 'string' ? a.createdAt : null,
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<PriorityStack zone={zone} />}
      items={items}
      itemsLabel="All ranked next-actions (proposed, accepted, rejected, completed)"
      deeperLinks={DEEPER_LINKS.daily}
      itemsEmptyHint="Build your baseline or ask Jarvis to run your daily briefing — priorities are ranked from your goals, risks, and opportunities."
    />
  );
}
