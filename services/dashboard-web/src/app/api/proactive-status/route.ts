import 'server-only';

/** Ack/dismiss a proactive event (CIN-2, D-180) — thin authenticated proxy. */
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, sessionSecret } from '@/lib/session';
import { buildAuthHeaders } from '@/lib/gateway-session';

export const dynamic = 'force-dynamic';

const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';
const ADMIN = process.env.FACTORY_ADMIN_TOKEN ?? '';

export async function POST(req: Request): Promise<Response> {
  let body: { eventId?: string; status?: string };
  try { body = (await req.json()) as { eventId?: string; status?: string }; } catch { return Response.json({ ok: false }, { status: 400 }); }
  if (!body.eventId || !body.status) return Response.json({ ok: false }, { status: 400 });
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token, sessionSecret()) : null;
    const headers = buildAuthHeaders(ADMIN, session ? { role: session.role, gatewaySessionToken: session.gatewaySessionToken } : null);
    const res = await fetch(`${API}/v1/proactive/${encodeURIComponent(body.eventId)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ status: body.status }),
    });
    return Response.json({ ok: res.ok }, { status: res.ok ? 200 : res.status });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
