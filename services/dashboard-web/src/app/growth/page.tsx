import { gateway } from '@/lib/gateway';
import { DomainRoom, type DomainRoomItem } from '@/components/domains/DomainRoom';
import { DEEPER_LINKS } from '@/lib/domainRoomLinks';
import { SkillLanes } from '@/components/domains/SkillLanes';
import { EmptyState } from '@/components/ui';

/** Phase AF.5 — dedicated Learning & Growth room. Was `/me/resume`
 *  (resume-only — learning tracks had no home of their own). */
export const dynamic = 'force-dynamic';

export default async function GrowthDomainPage() {
  const data = await gateway.universeDetail();
  const zone = data?.zones.find((z) => z.zoneId === 'growth');
  if (!data || !zone) return <EmptyState icon="·" title="Command Universe data unavailable" hint="Sign in and try again." />;

  const trackItems: DomainRoomItem[] = data.growth.learningTracks.map((t) => ({
    label: String(t.title ?? ''),
    detail: `${t.targetSkill ? `→ ${String(t.targetSkill)}` : 'no target skill set'} · ${String(t.status ?? '')}`,
    tone: t.status === 'active' ? 'ok' : 'neutral',
    timestamp: typeof t.createdAt === 'string' ? t.createdAt : null,
  }));
  const goalItems: DomainRoomItem[] = data.growth.goals.map((g) => ({
    label: String(g.title ?? ''),
    detail: `goal · ${String(g.status ?? '')} · priority ${String(g.priority ?? '')}`,
    tone: 'neutral',
  }));

  return (
    <DomainRoom
      zone={zone}
      visual={<SkillLanes zone={zone} />}
      items={[...trackItems, ...goalItems]}
      itemsLabel="All learning tracks and linked goals"
      deeperLinks={DEEPER_LINKS.growth}
      itemsEmptyHint="Ingest kind=learning_track (title, targetSkill, linkedGoalIds); ask Jarvis “analyze my resume” for gap-driven suggestions."
    />
  );
}
