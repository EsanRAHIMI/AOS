/**
 * `/` — Jarvis presence stage (was `/jarvis`).
 *
 * On production this is https://factory.simorx.com/ — the default signed-in
 * landing page. Command Universe lives at `/universe`.
 */
import JarvisCoreHUD from '@/app/jarvis/JarvisCoreHUD';

export const dynamic = 'force-dynamic';

export default function HomeJarvisPage() {
  return <JarvisCoreHUD />;
}
