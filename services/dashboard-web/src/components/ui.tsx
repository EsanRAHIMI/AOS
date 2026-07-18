import Link from 'next/link';
import type { ReactNode } from 'react';
import { AutoDir } from '@/components/AutoDir';

/** Page header with optional breadcrumbs, subtitle, and right-aligned actions. */
export function PageHeader({ title, subtitle, crumbs, actions }: { title: string; subtitle?: string; crumbs?: Array<[string, string]>; actions?: ReactNode }) {
  return (
    <div className="page-header">
      {crumbs && crumbs.length > 0 && (
        <div className="crumbs" data-no-auto-dir="">
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
          <AutoDir as="h1" className="h1" text={title}>{title}</AutoDir>
          {subtitle && <AutoDir as="p" className="sub" style={{ margin: 0 }} text={subtitle}>{subtitle}</AutoDir>}
        </div>
        {actions && <div className="actions" data-no-auto-dir="">{actions}</div>}
      </div>
    </div>
  );
}

/** A glass metric tile. */
export function MetricCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <div className="card metric">
      <AutoDir as="div" className="label" text={label}>{label}</AutoDir>
      <div className="stat" style={tone ? { WebkitTextFillColor: 'initial', color: `var(--${tone})`, background: 'none' } : undefined}>{value}</div>
      {hint && <AutoDir as="div" className="m" style={{ fontSize: 12.5 }} text={hint}>{hint}</AutoDir>}
    </div>
  );
}

/** Friendly empty state. */
export function EmptyState({ icon = '◌', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="ic">{icon}</div>
      <AutoDir style={{ fontWeight: 600, color: 'var(--text)' }} text={title}>{title}</AutoDir>
      {hint && <AutoDir as="div" className="m" style={{ marginTop: 4 }} text={hint}>{hint}</AutoDir>}
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
