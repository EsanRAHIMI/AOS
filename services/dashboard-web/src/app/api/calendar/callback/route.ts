/**
 * Google OAuth callback — on the DASHBOARD, not the gateway (D-193c).
 *
 * The redirect used to point at `localhost:4101`, the gateway. That asks the
 * browser to navigate to a different origin, on a different port, served by an
 * API server. Every way that can fail — a blocked cross-port navigation, an
 * embedded browser view, a proxy, a browser that will not render a bare API
 * response — strands the owner on Google's page with no way back. It did.
 *
 * Landing here instead means:
 *   - the redirect target is the SAME origin the owner is already using,
 *   - the code exchange happens server-side, so the browser never sees the
 *     gateway or an internal token,
 *   - and the trip home is an ordinary Next redirect, which cannot fail to
 *     land the way a cross-origin hop can.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { gateway } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const error = url.searchParams.get('error') ?? '';

  // Always return to the calendar page; the reason rides in the query so the
  // page can explain it in the owner's language.
  const back = (connect: string) =>
    NextResponse.redirect(new URL(`/calendar?connect=${encodeURIComponent(connect)}`, url.origin));

  if (error) return back(error);
  if (!code || !state) return back('missing_code');

  try {
    const res = await gateway.calendarExchange(code, state);
    if (res) return back('ok');

    /* A null response is not proof of failure — the gateway client aborts at a
     * fixed timeout, and a slow-but-successful exchange looks identical to a
     * broken one from here. So ask the source of truth: if a grant now exists,
     * the connection worked and reporting failure would be a lie. */
    const status = await gateway.calendarStatus();
    return back(status?.connected ? 'ok' : 'exchange_failed');
  } catch (e) {
    const message = e instanceof Error ? e.message : 'exchange_failed';
    return back(message.includes('bad_state') ? 'bad_state' : message.slice(0, 80));
  }
}
