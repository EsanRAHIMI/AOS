import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';
import { runSecurityCheckAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

const tone = (r: string) => (r === 'critical' || r === 'high' ? 'err' : r === 'medium' ? 'warn' : 'ok');

export default async function SecurityPage() {
  const [session, env, checks, events, safe] = await Promise.all([
    getSession(),
    gateway.securityEnv(),
    gateway.securityChecks() as Promise<Array<Record<string, unknown>> | null>,
    gateway.securityEvents(20) as Promise<Array<Record<string, unknown>> | null>,
    gateway.safeMode(),
  ]);
  const latest = (checks ?? [])[0];
  const evts = events ?? [];
  const denied = evts.filter((e) => e.result === 'denied').length;
  const failedLogins = evts.filter((e) => e.eventType === 'login.failed').length;

  return (
    <>
      <PageHeader
        title="Security & Hardening"
        subtitle="Who is using the system, what they may do, whether secrets and APIs are protected, and how to recover."
        actions={
          session?.role === 'owner' ? (
            <form action={runSecurityCheckAction}><button className="btn btn-primary" type="submit">Run security check</button></form>
          ) : undefined
        }
      />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Signed in as" value={<span style={{ fontSize: 18 }}>{session?.role ?? 'unknown'}</span>} hint={session?.email ?? ''} tone={session?.role === 'owner' ? 'ok' : undefined} />
        <MetricCard label="Env posture" value={env ? (env.passed ? 'pass' : env.riskLevel) : '—'} tone={env ? (env.passed ? 'ok' : tone(env.riskLevel)) : undefined} hint={env ? `${env.checks.filter((c) => c.passed).length}/${env.checks.length} checks pass` : 'gateway unreachable'} />
        <MetricCard label="Safe mode" value={safe?.enabled ? 'ON' : 'off'} tone={safe?.enabled ? 'warn' : 'ok'} hint={safe?.enabled ? 'mutations blocked' : 'normal operation'} />
        <MetricCard label="Denied / failed logins" value={`${denied} / ${failedLogins}`} tone={denied || failedLogins ? 'warn' : 'ok'} hint="recent" />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="label">Latest security check</span>
            <Link href="/security/env" className="chip">Env detail</Link>
          </div>
          {!latest ? (
            <EmptyState icon="🛡" title="No security check yet" hint={session?.role === 'owner' ? 'Run one with the button above.' : 'Ask an owner to run a security check.'} />
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span className={`badge ${latest.passed ? 'ok' : tone(String(latest.riskLevel))}`}>{latest.passed ? 'passed' : `${latest.riskLevel} risk`}</span>
                <span className="m" style={{ fontSize: 12.5 }}>{timeAgo(String(latest.createdAt))}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(latest.checks as Array<Record<string, unknown>>).map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                    <span>{String(c.label)}</span>
                    <span className={`badge ${c.passed ? 'ok' : tone(String(c.severity))}`}>{c.passed ? 'ok' : String(c.severity)}</span>
                  </div>
                ))}
              </div>
              {Array.isArray(latest.recommendations) && (latest.recommendations as string[]).length > 0 && (
                <ul className="sub" style={{ marginTop: 12, marginBottom: 0, paddingLeft: 18 }}>
                  {(latest.recommendations as string[]).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="label">Recent security events</span>
            <Link href="/security/events" className="chip">All events</Link>
          </div>
          {evts.length === 0 ? (
            <EmptyState icon="✓" title="No security events yet" hint="Logins, denials and auth failures appear here." />
          ) : (
            <div className="timeline">
              {evts.slice(0, 8).map((e, i) => (
                <div className={`ti ${e.result === 'denied' || e.result === 'failure' ? 'err' : e.result === 'info' ? 'warn' : 'ok'}`} key={i}>
                  <div className="m" style={{ fontSize: 11.5 }}>{timeAgo(String(e.createdAt))} · {String(e.actorId)} {e.role ? `(${e.role})` : ''}</div>
                  <div style={{ fontSize: 13 }}>{String(e.eventType)} — {String(e.detail || e.result)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Hardening controls</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/security/events" className="chip">Security events</Link>
          <Link href="/security/env" className="chip">Env / secret health</Link>
          <Link href="/security/rate-limits" className="chip">Rate limits</Link>
          <Link href="/security/safe-mode" className="chip">Safe mode</Link>
          <Link href="/rbac" className="chip">Roles &amp; permissions</Link>
          <Link href="/audit-logs" className="chip">Audit log</Link>
        </div>
      </div>
    </>
  );
}
