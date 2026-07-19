import 'server-only';

/**
 * Server-side SSE proxy for the persistent owner stream (CIN-2, D-180).
 * The browser opens ONE EventSource here; this handler pipes the gateway's
 * `/v1/stream/owner` events (presence / proactive / ping) straight through.
 * Secrets stay on the server; the client auto-reconnects on stream.end.
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

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${API}/v1/stream/owner`, {
      headers: { ...(await authHeaders()) },
    });
    if (!upstream.ok || !upstream.body) {
      return new Response('event: stream.end\ndata: {"reconnect":true}\n\n', {
        status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }
    return new Response(upstream.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch {
    return new Response('event: stream.end\ndata: {"reconnect":true}\n\n', {
      status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
}
