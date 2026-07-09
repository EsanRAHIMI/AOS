import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { getBriefingAction } from '@/app/jarvis/actions';
import { getUniverseAction } from '@/app/universe/actions';
import { getLiveStateAction } from '@/app/operator/actions';
import { UniverseProvider } from '@/components/UniverseProvider';
import { HomeLive } from '@/components/HomeLive';

export const dynamic = 'force-dynamic';

/**
 * Phase AF.1 — The Command Universe, foundation of the Living AI Government
 * vision (docs/living-command-universe-vision.md).
 *
 * Phase AF.4 — this page is now a thin server shell: it does the initial
 * fetch (fast first paint, unchanged) and hands the data to
 * `UniverseProvider`, which `HomeLive` (client) reads from. Everything that
 * used to be static server-rendered JSX here — Presence Bar, Focus Row,
 * the nine Domain Canvas zones, live pulse — now lives in `HomeLive` so it
 * can update itself after a domain action or a relevant background event
 * without a full page refresh. See `UniverseProvider.tsx` for the
 * block-invalidation model.
 *
 * Phase AF.4.1 — also fetches the live operation feed on first paint, so
 * active/recent operations survive a refresh instead of only existing in
 * `OperatorConsole`'s React memory (the exact bug reported by real-user
 * testing). Added to the same `Promise.all`, so this doesn't add a serial
 * round trip to the page's first paint.
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
