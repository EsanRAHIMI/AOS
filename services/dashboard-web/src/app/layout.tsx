import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Sidebar } from '@/components/Sidebar';
import { MobileTopBar, MobileTabBar } from '@/components/MobileChrome';
import { SafeModeBanner } from '@/components/SafeModeBanner';
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

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
      </body>
    </html>
  );
}
