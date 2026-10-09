'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toggleJarvis } from '@/lib/jarvisDock';

/** The five places a Jarvis owner actually opens. The middle control is not a page. */
const TABS: Array<{ href: string; label: string; icon: 'home' | 'calendar' | 'bell' | 'person' }> = [
  { href: '/jarvis', label: 'خانه', icon: 'home' },
  { href: '/calendar', label: 'تقویم', icon: 'calendar' },
  { href: '/approvals', label: 'تأیید', icon: 'bell' },
  { href: '/me', label: 'من', icon: 'person' },
];

function TabIcon({ name }: { name: 'home' | 'calendar' | 'bell' | 'person' }) {
  const common = { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': true as const };
  if (name === 'home') {
    return (
      <svg {...common}>
        <path d="M4.5 10.5 12 4.5l7.5 6V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.2H10.2V20.5H6A1.5 1.5 0 0 1 4.5 19v-8.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'calendar') {
    return (
      <svg {...common}>
        <rect x="4" y="5.5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 4.5v3M16 4.5v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'bell') {
    return (
      <svg {...common}>
        <path d="M6.2 9.4a5.8 5.8 0 1 1 11.6 0c0 5.6 1.6 6.2 1.6 7.6H4.6c0-1.4 1.6-2 1.6-7.6z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M10 18.8a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="8.2" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.4 19.2c1.2-3 3.5-4.4 6.6-4.4s5.4 1.4 6.6 4.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

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

function paintHorizon(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const hole = 34;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.42);
  ctx.scale(1, 0.42);
  const disk = ctx.createRadialGradient(0, 0, hole * 0.72, 0, 0, 78);
  disk.addColorStop(0, 'rgba(255, 220, 180, 0)');
  disk.addColorStop(0.46, 'rgba(255, 178, 112, 0.45)');
  disk.addColorStop(0.72, 'rgba(176, 64, 58, 0.18)');
  disk.addColorStop(1, 'rgba(60, 16, 32, 0)');
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(0, 0, 78, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, hole + 3, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 232, 206, 0.95)';
  ctx.lineWidth = 2.4;
  ctx.shadowColor = 'rgba(255, 160, 100, 0.9)';
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, hole, 0, Math.PI * 2);
  ctx.fill();
}

function Horizon() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const size = 168;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintHorizon(ctx, size, size);
  }, []);
  return <canvas ref={ref} className="tab-horizon" aria-hidden />;
}

export function MobileTabBar() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [pressed, setPressed] = useState<string | null>(null);
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  useEffect(() => { setPressed(null); }, [pathname]);
  useEffect(() => {
    for (const tab of TABS) router.prefetch(tab.href);
  }, [router]);

  const item = (tab: (typeof TABS)[number]) => (
    <Link
      key={tab.href}
      href={tab.href}
      prefetch
      aria-label={tab.label}
      className={pressed === tab.href || (pressed === null && active(pathname, tab.href)) ? 'active' : ''}
      onPointerDown={() => setPressed(tab.href)}
    >
      <TabIcon name={tab.icon} />
    </Link>
  );

  return (
    <nav className="mobile-tabbar" dir="rtl" aria-label="ناوبری">
      <Horizon />
      {left.map(item)}
      <span className="tab-slot" aria-hidden />
      <button type="button" className="tab-speak" aria-label="بگو" onClick={() => toggleJarvis()} />
      {right.map(item)}
    </nav>
  );
}
