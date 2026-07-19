import 'server-only';

/** Manual loop tick (CIN-2b, D-181) — authenticated proxy. */
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, sessionSecret } from '@/lib/session';
import { buildAuthHeaders } from '@/lib/gateway-session';

export const dynamic = 'force-dynamic';
const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';
const ADMIN = process.env.FACTORY_ADMIN_TOKEN ?? '';

export async function POST(): Promise<Response> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token, sessionSecret()) : null;
    const headers = buildAuthHeaders(ADMIN, session ? { role: session.role, gatewaySessionToken: session.gatewaySessionToken } : null);
    const res = await fetch(`${API}/v1/loop/tick`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    return Response.json(await res.json().catch(() => ({ ok: res.ok })), { status: res.status });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
