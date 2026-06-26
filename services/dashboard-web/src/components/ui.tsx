import Link from 'next/link';
import type { ReactNode } from 'react';

/** Page header with optional breadcrumbs, subtitle, and right-aligned actions. */
export function PageHeader({ title, subtitle, crumbs, actions }: { title: string; subtitle?: string; crumbs?: Array<[string, string]>; actions?: ReactNode }) {
  return (
    <div className="page-header">
      {crumbs && crumbs.length > 0 && (
        <div className="crumbs">
          {crumbs.map(([href, label], i) => (
            <span key={href}>
              {i > 0 && <span style={{ opacity: 0.5 }}> / </span>}
              <Link href={href}>{label}</Link>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="h1">{title}</h1>
          {subtitle && <p className="sub" style={{ margin: 0 }}>{subtitle}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

/** A glass metric tile. */
export function MetricCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <div className="card metric">
      <div className="label">{label}</div>
      <div className="stat" style={tone ? { WebkitTextFillColor: 'initial', color: `var(--${tone})`, background: 'none' } : undefined}>{value}</div>
      {hint && <div className="m" style={{ fontSize: 12.5 }}>{hint}</div>}
    </div>
  );
}

/** Friendly empty state. */
export function EmptyState({ icon = '◌', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="ic">{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {hint && <div className="m" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** Map a status string to a pill tone. */
export function statusTone(s: string): 'ok' | 'warn' | 'err' | '' {
  const v = s.toLowerCase();
  if (/(ok|active|completed|passed|resolved|approved|healthy|fulfilled|generated|validated|converted|up)/.test(v)) return 'ok';
  if (/(failed|cancelled|rejected|error|down|blocked|unhealthy)/.test(v)) return 'err';
  if (/(awaiting|pending|waiting|warn|degraded|running|queued|planning|proposed|changes)/.test(v)) return 'warn';
  return '';
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`badge ${statusTone(status)}`}>{status}</span>;
}
