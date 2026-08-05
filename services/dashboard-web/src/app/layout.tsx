import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Sidebar } from '@/components/Sidebar';
import { MobileTopBar, MobileTabBar } from '@/components/MobileChrome';
import { SafeModeBanner } from '@/components/SafeModeBanner';
import { JarvisRudder } from '@/components/JarvisRudder';
import { RtlAutoDir } from '@/components/RtlAutoDir';
import { getSession } from '@/lib/auth';
import { gateway } from '@/lib/gateway';
import { isJarvisApexHost, requestPublicHost } from '@/lib/hosts';

export const metadata: Metadata = {
  title: 'Factory · Autonomous OS Control Room',
  description: 'Premium real-time control room for the autonomous operating-system kernel.',
};

export const viewport: Viewport = {
  themeColor: '#070a12',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/login/');
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const hdrs = await headers();
  const pathname = hdrs.get('x-factory-pathname') ?? '';
  // Prefer middleware flag; fall back to live host headers (Cloudflare/Traefik).
  const apex = hdrs.get('x-jarvis-apex') === '1' || isJarvisApexHost(requestPublicHost(hdrs));

  // Cookie present but invalid/expired — send back to login (Node verifies the signature).
  if (!session && pathname && !isPublicPath(pathname)) {
    redirect(`/login?next=${encodeURIComponent(pathname || '/')}`);
  }

  // Unauthenticated (e.g. /login): bare shell, no nav chrome.
  if (!session) {
    return (
      <html lang="en">
        <body className={apex ? 'jarvis-apex' : undefined}>
          <RtlAutoDir />
          {children}
        </body>
      </html>
    );
  }

  // Public Jarvis home on simorx.com — stage only, no control-room chrome.
  // Control room remains at factory.simorx.com.
  if (apex) {
    return (
      <html lang="en">
        <body className="jarvis-apex">
          <RtlAutoDir />
          <main className="main main--apex">
            {children}
          </main>
          <JarvisRudder role={session.role} />
          <p className="apex-factory-link" dir="rtl">
            <Link href="https://factory.simorx.com/">اتاق کنترل Factory</Link>
          </p>
        </body>
      </html>
    );
  }

  // D-184: ONE assistant for the whole system. `JarvisDock` is the K2 Jarvis
  // agent (same sessions, memory and tools as the /jarvis stage) mounted once
  // here, so it is available on every page and its state survives navigation.
  // It fetches its own briefing; the layout only needs safe-mode now.
  const safe = await gateway.safeMode();
  const user = { email: session.email, role: session.role };
  return (
    <html lang="en">
      <body>
        <RtlAutoDir />
        <MobileTopBar user={user} />
        <div className="app-shell">
          <Sidebar user={user} />
          <main className="main">
            <SafeModeBanner enabled={Boolean(safe?.enabled)} role={session.role} />
            {children}
          </main>
        </div>
        <MobileTabBar />
        <JarvisRudder role={session.role} />
      </body>
    </html>
  );
}
