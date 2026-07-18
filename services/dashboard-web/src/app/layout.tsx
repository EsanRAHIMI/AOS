import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { MobileTopBar, MobileTabBar } from '@/components/MobileChrome';
import { SafeModeBanner } from '@/components/SafeModeBanner';
import { OperatorConsole } from '@/components/OperatorConsole';
import { RtlAutoDir } from '@/components/RtlAutoDir';
import { getSession } from '@/lib/auth';
import { gateway } from '@/lib/gateway';
import { getBriefingAction } from '@/app/jarvis/actions';

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
  const pathname = (await headers()).get('x-factory-pathname') ?? '';

  // Cookie present but invalid/expired — send back to login (Node verifies the signature).
  if (!session && pathname && !isPublicPath(pathname)) {
    redirect(`/login?next=${encodeURIComponent(pathname)}`);
  }

  // Unauthenticated (e.g. /login): bare shell, no nav chrome.
  if (!session) {
    return (
      <html lang="en">
        <body>
          <RtlAutoDir />
          {children}
        </body>
      </html>
    );
  }

  // Phase AF.1 Step 1 — fetch once at the layout level (mounted once, not
  // per-page) so the persistent Jarvis shell's ambient bar shows the real
  // priority on first paint instead of a blank state until a client fetch
  // resolves. The shell refreshes this itself afterward (OperatorConsole).
  const [safe, initialBriefing] = await Promise.all([gateway.safeMode(), getBriefingAction()]);
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
        <OperatorConsole role={session.role} initialBriefing={initialBriefing} />
      </body>
    </html>
  );
}
