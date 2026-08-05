/**
 * Host roles for the dashboard.
 *
 * - factory.*  → Autonomous OS control room (Command Universe, ops UI)
 * - apex / www → public Jarvis home (same Next app, rewritten to /jarvis)
 *
 * Dokploy points both hostnames at dashboard-web; routing is decided here.
 */

export const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'simorx.com';

/** Hosts that should present Jarvis at `/` (and treat `/jarvis` as `/`). */
export function jarvisApexHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.JARVIS_PUBLIC_HOSTS || `${ROOT_DOMAIN},www.${ROOT_DOMAIN}`;
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

export function normalizeHost(hostHeader: string | null | undefined): string {
  return (hostHeader ?? '').split(':')[0]!.trim().toLowerCase();
}

export function isJarvisApexHost(hostHeader: string | null | undefined, env?: NodeJS.ProcessEnv): boolean {
  const host = normalizeHost(hostHeader);
  if (!host) return false;
  return jarvisApexHosts(env).includes(host);
}

/** Shared session cookie across factory.* and apex (production). */
export function dashboardCookieDomain(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DASHBOARD_COOKIE_DOMAIN) return env.DASHBOARD_COOKIE_DOMAIN;
  if (env.NODE_ENV === 'production') return `.${ROOT_DOMAIN}`;
  return undefined;
}
