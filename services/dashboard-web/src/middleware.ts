import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

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
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-factory-pathname', pathname);

  if (!hasCookie && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
