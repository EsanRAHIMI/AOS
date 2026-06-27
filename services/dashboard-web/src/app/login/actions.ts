'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { authenticate, createSessionCookie, clearSessionCookie, getSession } from '@/lib/auth';
import { gateway } from '@/lib/gateway';

export interface LoginState {
  error?: string;
}

function safeNext(next: string | null): string {
  // Only allow same-site relative paths to avoid open-redirects.
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

// Simple in-memory login throttle (per-process; replace with Redis to scale).
// 8 attempts per 5 minutes per email+ip.
const loginHits = new Map<string, { count: number; resetAt: number }>();
function loginRateExceeded(key: string): boolean {
  const now = Date.now();
  const cur = loginHits.get(key);
  if (!cur || cur.resetAt <= now) {
    loginHits.set(key, { count: 1, resetAt: now + 5 * 60_000 });
    return false;
  }
  cur.count += 1;
  return cur.count > 8;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNext(String(formData.get('next') ?? '/'));

  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (loginRateExceeded(`${email.toLowerCase()}:${ip}`)) {
    await gateway.reportSecurityEvent({ eventType: 'login.rate_limited', actorId: email || 'unknown', result: 'denied', target: 'dashboard', riskLevel: 'high', detail: 'too many login attempts' });
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }

  const user = authenticate(email, password);
  if (!user) {
    await gateway.reportSecurityEvent({ eventType: 'login.failed', actorId: email || 'unknown', result: 'failure', target: 'dashboard', riskLevel: 'medium', detail: 'invalid credentials' });
    return { error: 'Invalid email or password.' };
  }
  await createSessionCookie(user.email, user.role);
  await gateway.reportSecurityEvent({ eventType: 'login.succeeded', actorId: user.email, role: user.role, result: 'success', target: 'dashboard', riskLevel: 'low', detail: `signed in as ${user.role}` });
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    await gateway.reportSecurityEvent({ eventType: 'logout', actorId: session.email, role: session.role, result: 'info', target: 'dashboard', riskLevel: 'low', detail: 'signed out' });
  }
  await clearSessionCookie();
  redirect('/login');
}
