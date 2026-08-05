import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';
import { isJarvisApexHost, normalizeHost } from '@/lib/hosts';

/** Routes reachable without a session cookie. */
const PUBLIC_PATHS = [
  '/login',
  /* Google redirects the browser here after consent. It carries Google's
   * `code`, not our session, and bouncing it to /login would drop the code and
   * strand the owner. The route itself exchanges server-side and redirects. */
  '/api/calendar/callback',
];

/**
 * Lightweight gate: only checks that the session cookie exists.
 * Cryptographic verification runs in Node (layout / server actions) where
 * DASHBOARD_SESSION_SECRET is always available — Edge cannot reliably read it.
 *
 * Apex host (`simorx.com`): `/` is rewritten to the Jarvis stage so the
 * public URL stays https://simorx.com/ while factory.simorx.com keeps the
 * control room at `/`.
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const host = normalizeHost(req.headers.get('host'));
  const apex = isJarvisApexHost(host);
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-factory-pathname', pathname);
  requestHeaders.set('x-factory-host', host);
  if (apex) requestHeaders.set('x-jarvis-apex', '1');

  // Canonical public Jarvis URL: /jarvis on the apex → /
  if (apex && (pathname === '/jarvis' || pathname === '/jarvis/')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Control-room routes live on factory.*; keep the apex for Jarvis + auth + APIs.
  if (apex) {
    const apexOk = pathname === '/'
      || pathname.startsWith('/login')
      || pathname.startsWith('/api/')
      || pathname.startsWith('/_next/')
      || pathname === '/favicon.ico';
    if (!apexOk) {
      const factory = new URL(req.url);
      factory.host = `factory.${process.env.ROOT_DOMAIN || 'simorx.com'}`;
      factory.protocol = 'https:';
      return NextResponse.redirect(factory);
    }
  }

  if (!hasCookie && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', apex && pathname === '/' ? '/' : pathname);
    return NextResponse.redirect(url);
  }

  // Apex home is the Jarvis stage; keep the browser URL as /.
  if (apex && pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/jarvis';
    requestHeaders.set('x-factory-pathname', '/');
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
