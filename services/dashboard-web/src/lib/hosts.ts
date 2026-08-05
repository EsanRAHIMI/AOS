/**
 * Host roles for the dashboard.
 *
 * - factory.*  → Autonomous OS control room (Command Universe, ops UI)
 * - apex / www → public Jarvis home (same Next app, rewritten to /jarvis)
 *
 * Dokploy points both hostnames at dashboard-web; routing is decided here.
 * Behind Cloudflare/Traefik the useful hostname is often `x-forwarded-host`,
 * not the raw `Host` header — always resolve through `requestPublicHost`.
 */

export const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'simorx.com';

/** Hosts that should present Jarvis at `/` (and treat `/jarvis` as `/`). */
export function jarvisApexHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = (env.ROOT_DOMAIN || ROOT_DOMAIN).toLowerCase();
  const raw = env.JARVIS_PUBLIC_HOSTS || `${root},www.${root}`;
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

export function normalizeHost(hostHeader: string | null | undefined): string {
  return (hostHeader ?? '').split(':')[0]!.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Public hostname the browser used. Prefer forwarded headers that reverse
 * proxies (Cloudflare → Traefik → Dokploy) set when the container Host is
 * rewritten to an internal name or the sibling factory.* domain.
 */
export function requestPublicHost(headersLike: Headers | { get(name: string): string | null }): string {
  const forwarded = headersLike.get('x-forwarded-host');
  if (forwarded) return normalizeHost(forwarded.split(',')[0]);
  const original = headersLike.get('x-original-host');
  if (original) return normalizeHost(original);
  return normalizeHost(headersLike.get('host'));
}

export function isJarvisApexHost(hostHeader: string | null | undefined, env?: NodeJS.ProcessEnv): boolean {
  const host = normalizeHost(hostHeader);
  if (!host) return false;
  return jarvisApexHosts(env).includes(host);
}

/** Shared session cookie across factory.* and apex (production). */
export function dashboardCookieDomain(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DASHBOARD_COOKIE_DOMAIN) return env.DASHBOARD_COOKIE_DOMAIN;
  const root = (env.ROOT_DOMAIN || ROOT_DOMAIN).toLowerCase();
  if (env.NODE_ENV === 'production') return `.${root}`;
  return undefined;
}
