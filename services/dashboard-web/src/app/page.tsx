import { headers } from 'next/headers';
import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { getBriefingAction } from '@/app/jarvis/actions';
import { getUniverseAction } from '@/app/universe/actions';
import { getLiveStateAction } from '@/app/operator/actions';
import { UniverseProvider } from '@/components/UniverseProvider';
import { HomeLive } from '@/components/HomeLive';
import JarvisCoreHUD from '@/app/jarvis/JarvisCoreHUD';
import { isJarvisApexHost, requestPublicHost } from '@/lib/hosts';

export const dynamic = 'force-dynamic';

/**
 * factory.simorx.com/ → Command Universe (control room).
 * simorx.com/ → Jarvis stage (public home). Middleware also rewrites apex `/`
 * to `/jarvis`; this host check is the belt-and-suspenders path when the
 * reverse proxy rewrites Host and the rewrite does not fire.
 */
export default async function HomePage() {
  const host = requestPublicHost(await headers());
  if (isJarvisApexHost(host)) {
    return <JarvisCoreHUD />;
  }

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
