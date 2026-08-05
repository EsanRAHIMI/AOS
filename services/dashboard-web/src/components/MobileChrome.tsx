'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Top status bar + bottom tab bar shown only on mobile/tablet widths. */
const TABS: Array<[string, string, string]> = [
  ['/', 'Home', '◎'],
  ['/tasks', 'Tasks', '◇'],
  ['/services', 'Services', '⬡'],
  ['/approvals', 'Approvals', '✓'],
  ['/learning', 'Learning', '✦'],
];

function active(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileTopBar({ user }: { user?: { email: string; role: string } }) {
  return (
    <header className="mobile-topbar">
      <div className="brand" style={{ padding: 0 }}>
        <span className="logo" />
        <span style={{ fontSize: 14 }}>
          FACTORY
          <small>control room</small>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {user && <span className={`badge ${user.role === 'owner' ? 'ok' : user.role === 'viewer' ? '' : 'warn'}`}>{user.role}</span>}
        <Link href="/tasks" className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 13 }}>+ Task</Link>
      </div>
    </header>
  );
}

export function MobileTabBar() {
  const pathname = usePathname() ?? '/';
  return (
    <nav className="mobile-tabbar">
      {TABS.map(([href, label, ic]) => (
        <Link key={href} href={href} className={active(pathname, href) ? 'active' : ''}>
          <span className="ic">{ic}</span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
