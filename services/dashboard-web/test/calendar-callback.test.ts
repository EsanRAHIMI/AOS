/**
 * D-193c — the return trip from Google must land in the app.
 *
 * The redirect used to target the gateway on port 4101: a different origin, and
 * an API server rather than a web app. That is what left the owner stranded on
 * Google's page. These assert the structure that fixes it, because the failure
 * is not something a unit test can reproduce — it lives in the browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('oauth callback lives on the dashboard', () => {
  it('the route exists at the same origin as the app', () => {
    expect(existsSync(join(process.cwd(), 'src/app/api/calendar/callback/route.ts'))).toBe(true);
  });

  it('exchanges server-side and redirects only within this origin', () => {
    const route = read('src/app/api/calendar/callback/route.ts');
    expect(route).toContain('calendarExchange');
    // Every redirect is built from the request's own origin — the browser is
    // never sent to another host or port.
    expect(route).toContain('url.origin');
    const redirects = route.match(/NextResponse\.redirect\(/g) ?? [];
    const originBuilt = route.match(/new URL\(`\/calendar\?connect=/g) ?? [];
    expect(originBuilt.length).toBe(redirects.length);
  });

  it('always redirects back to /calendar, whatever happened', () => {
    const route = read('src/app/api/calendar/callback/route.ts');
    // Every branch — error, missing code, thrown exchange — goes home.
    expect(route).toContain('/calendar?connect=');
    const branches = route.match(/return back\(/g) ?? [];
    expect(branches.length).toBeGreaterThanOrEqual(4);
  });

  it('is reachable without a session, or Google\'s code would be dropped at /login', () => {
    expect(read('src/middleware.ts')).toContain('/api/calendar/callback');
  });

  it('the configured redirect URI points at the dashboard, not the gateway', () => {
    const env = read('../../.env.example');
    expect(env).toContain('GOOGLE_REDIRECT_URI=http://localhost:4100/api/calendar/callback');
    expect(env).not.toContain('4101/v1/calendar/oauth/callback');
  });
});
