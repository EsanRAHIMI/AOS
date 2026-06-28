import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { SERVICE_CATALOG } from '@/lib/services-catalog';
import { PageHeader, MetricCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

type State = 'pass' | 'warn' | 'fail' | 'unknown';
interface Check { label: string; state: State; detail: string; href?: string }
const tone = (s: State) => (s === 'pass' ? 'ok' : s === 'fail' ? 'err' : s === 'warn' ? 'warn' : '');

export default async function ReadinessPage() {
  const [services, env, safe, llm, integ, sec, learning, reports, incidents] = await Promise.all([
    gateway.services() as Promise<unknown[] | null>,
    gateway.securityEnv(),
    gateway.safeMode(),
    gateway.llmCosts(),
    gateway.integrations(),
    gateway.securityChecks() as Promise<Array<Record<string, unknown>> | null>,
    gateway.learningRuns() as Promise<unknown[] | null>,
    gateway.reports() as Promise<unknown[] | null>,
    gateway.incidents() as Promise<Array<Record<string, unknown>> | null>,
  ]);

  const registered = (services ?? []).length;
  const envCheck = (id: string) => env?.checks.find((c) => c.id === id);
  const latestSec = (sec ?? [])[0];
  const openCritical = (incidents ?? []).filter((i) => i.status !== 'resolved' && i.status !== 'closed' && (i.severity === 'critical' || i.severity === 'high')).length;

  const checks: Check[] = [
    { label: 'Services reachable / registered', state: registered >= SERVICE_CATALOG.length ? 'pass' : registered > 0 ? 'warn' : 'fail', detail: `${registered} of ${SERVICE_CATALOG.length} services registered with the live registry`, href: '/system-map' },
    { label: 'Security check passed', state: !sec || sec.length === 0 ? 'warn' : latestSec?.passed ? 'pass' : 'fail', detail: !sec || sec.length === 0 ? 'No security check run yet' : latestSec?.passed ? 'Latest check passed' : `Latest check: ${String(latestSec?.riskLevel)} risk`, href: '/security' },
    { label: 'Safe mode status known', state: safe ? (safe.enabled ? 'warn' : 'pass') : 'unknown', detail: safe ? (safe.enabled ? 'Safe mode is ON — mutations blocked' : 'Off — normal operation') : 'Gateway unreachable', href: '/security/safe-mode' },
    { label: 'Auth / session secret configured', state: envCheck('session_secret')?.passed ? 'pass' : 'fail', detail: envCheck('session_secret')?.detail ?? 'unknown', href: '/security/env' },
    { label: 'LLM provider status known', state: llm ? (llm.status?.mode === 'real' ? 'pass' : 'warn') : 'unknown', detail: llm ? (llm.status?.mode === 'real' ? `Real provider: ${llm.status.provider}` : 'Deterministic fallback (no key)') : 'unknown', href: '/llm' },
    { label: 'GitHub delivery mode known', state: integ ? (integ.github.configured ? 'pass' : 'warn') : 'unknown', detail: integ ? `GitHub: ${integ.github.mode}` : 'unknown', href: '/github' },
    { label: 'S3 file storage configured', state: envCheck('s3_credentials')?.passed ? 'pass' : 'warn', detail: envCheck('s3_credentials')?.detail ?? 'unknown', href: '/security/env' },
    { label: 'Latest learning run exists', state: (learning ?? []).length > 0 ? 'pass' : 'warn', detail: (learning ?? []).length > 0 ? `${(learning ?? []).length} learning run(s)` : 'No learning run yet', href: '/learning' },
    { label: 'Latest report exists', state: (reports ?? []).length > 0 ? 'pass' : 'warn', detail: (reports ?? []).length > 0 ? `${(reports ?? []).length} report(s)` : 'No report yet', href: '/reports/center' },
    { label: 'No critical incidents open', state: openCritical === 0 ? 'pass' : 'fail', detail: openCritical === 0 ? 'No critical/high incidents open' : `${openCritical} open`, href: '/incidents' },
  ];

  const passed = checks.filter((c) => c.state === 'pass').length;
  const failed = checks.filter((c) => c.state === 'fail').length;

  return (
    <>
      <PageHeader title="Product Readiness" subtitle="Real production-readiness status of the live kernel, computed from actual system state. Nothing here is simulated." />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Ready" value={`${passed}/${checks.length}`} tone={failed ? 'warn' : 'ok'} />
        <MetricCard label="Failing" value={failed} tone={failed ? 'err' : 'ok'} />
        <MetricCard label="Services registered" value={`${registered}/${SERVICE_CATALOG.length}`} />
        <MetricCard label="Safe mode" value={safe?.enabled ? 'ON' : 'off'} tone={safe?.enabled ? 'warn' : 'ok'} />
      </div>
      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 4px', borderBottom: i < checks.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5 }}>{c.label}</div>
                <div className="m" style={{ fontSize: 12.5 }}>{c.detail}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
                <span className={`badge ${tone(c.state)}`}>{c.state}</span>
                {c.href && <Link href={c.href} className="chip">view</Link>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
