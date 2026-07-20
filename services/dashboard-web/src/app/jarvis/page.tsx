/**
 * /jarvis — the persistent, always-alive Jarvis presence stage (K2, D-177).
 * A single living canvas (core + neural threads to memory/loop/heartbeat/
 * trust/missions/research) replaces the old chat-box look. See
 * JarvisCoreHUD.tsx for the visual layer and docs/jarvis-spec.md for the
 * underlying turn/session pipeline it calls into.
 */
import JarvisCoreHUD from './JarvisCoreHUD';

export const dynamic = 'force-dynamic';

export default function JarvisPage() {
  return <JarvisCoreHUD />;
}
