import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Sidebar } from '@/components/Sidebar';
import { MobileTopBar, MobileTabBar } from '@/components/MobileChrome';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MobileTopBar />
        <div className="app-shell">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
        <MobileTabBar />
      </body>
    </html>
  );
}
