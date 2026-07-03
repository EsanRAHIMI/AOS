import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { MobileTopBar, MobileTabBar } from '@/components/MobileChrome';
import { SafeModeBanner } from '@/components/SafeModeBanner';
import { OperatorConsole } from '@/components/OperatorConsole';
import { getSession } from '@/lib/auth';
import { gateway } from '@/lib/gateway';

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
        <body>{children}</body>
      </html>
    );
  }

  const safe = await gateway.safeMode();
  const user = { email: session.email, role: session.role };
  return (
    <html lang="en">
      <body>
        <MobileTopBar user={user} />
        <div className="app-shell">
          <Sidebar user={user} />
          <main className="main">
            <SafeModeBanner enabled={Boolean(safe?.enabled)} role={session.role} />
            {children}
          </main>
        </div>
        <MobileTabBar />
        <OperatorConsole role={session.role} />
      </body>
    </html>
  );
}
