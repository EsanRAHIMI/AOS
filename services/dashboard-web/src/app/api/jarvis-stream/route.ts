import 'server-only';

/**
 * Server-side SSE proxy for a Jarvis turn (K2, D-177). The browser POSTs the
 * turn text here; this handler forwards to the gateway's streaming turn
 * endpoint (`?stream=1`) with the caller's real auth headers and pipes the
 * loop.step / turn.final events straight through. Secrets stay on the server.
 */
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, sessionSecret } from '@/lib/session';
import { buildAuthHeaders } from '@/lib/gateway-session';

export const dynamic = 'force-dynamic';

const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';
const ADMIN = process.env.FACTORY_ADMIN_TOKEN ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token, sessionSecret()) : null;
    return buildAuthHeaders(ADMIN, session ? { role: session.role, gatewaySessionToken: session.gatewaySessionToken } : null);
  } catch {
    return buildAuthHeaders(ADMIN, null);
  }
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return new Response('missing sessionId', { status: 400 });
  const body = await req.text();
  try {
    const upstream = await fetch(`${API}/v1/jarvis/sessions/${encodeURIComponent(sessionId)}/turns?stream=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body,
    });
    if (!upstream.ok || !upstream.body) {
      return new Response('event: turn.error\ndata: {"message":"gateway unreachable"}\n\n', {
        status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }
    return new Response(upstream.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch {
    return new Response('event: turn.error\ndata: {"message":"gateway unreachable"}\n\n', {
      status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
}
