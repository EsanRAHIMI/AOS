import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession, sessionSecret } from '@/lib/session';

/** Routes reachable without a session. */
const PUBLIC_PATHS = ['/login'];

/**
 * Gate every dashboard route behind a valid session. Unauthenticated users are
 * redirected to /login; authenticated users hitting /login are sent home.
 * Session verification uses Web Crypto so it runs in the edge runtime.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token, sessionSecret()) : null;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (session && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.delete('next');
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Exclude Next internals and static assets; everything else is protected.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
