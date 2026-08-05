import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { getBriefingAction } from '@/app/jarvis/actions';
import { getUniverseAction } from '@/app/universe/actions';
import { getLiveStateAction } from '@/app/operator/actions';
import { UniverseProvider } from '@/components/UniverseProvider';
import { HomeLive } from '@/components/HomeLive';

export const dynamic = 'force-dynamic';

/**
 * Command Universe — previously at `/`. Now at `/universe` so the product
 * root (`factory.simorx.com/`) is the Jarvis presence stage.
 *
 * Phase AF.1 / AF.4 / AF.4.1 — thin server shell: initial fetch for first
 * paint, then `UniverseProvider` + `HomeLive` for live updates.
 */
export default async function CommandUniversePage() {
  const [session, universe, ctx, briefing, liveState] = await Promise.all([
    getSession(),
    getUniverseAction(),
    gateway.meContext(),
    getBriefingAction(),
    getLiveStateAction(),
  ]);

  return (
    <UniverseProvider initialUniverse={universe} initialBriefing={briefing} initialLiveState={liveState}>
      <HomeLive session={session ? { role: session.role } : null} ctx={ctx} />
    </UniverseProvider>
  );
}
