import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { PageHeader, MetricCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function StartPage() {
  const [session, status, services, llm] = await Promise.all([
    getSession(), gateway.systemStatus(), gateway.services() as Promise<unknown[] | null>, gateway.llmCosts(),
  ]);
  const real = llm?.status?.mode === 'real';
  return (
    <>
      <PageHeader title="Welcome to the Autonomous OS Kernel" subtitle={`Signed in as ${session?.email ?? 'operator'} (${session?.role ?? 'role'}). This is a real autonomous operating system — here's how to use it.`} />

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ marginTop: 0 }}>
          The kernel is a network of independent services that <b>plan, build, validate, monitor, repair, reason, learn and report</b> — under your control.
          You give it a goal; it routes the goal to the right agents, does real work, produces <b>evidence</b>, and asks for your approval on anything sensitive.
        </p>
        <div className="grid cols-4" style={{ marginTop: 8 }}>
          <MetricCard label="Tasks run" value={status?.taskCount ?? 0} />
          <MetricCard label="Registered services" value={(services ?? []).length} />
          <MetricCard label="AI reasoning" value={real ? 'real' : 'fallback'} tone={real ? 'ok' : 'warn'} hint={real ? 'provider configured' : 'deterministic'} />
          <MetricCard label="Pending approvals" value={status?.pendingApprovals ?? 0} tone={(status?.pendingApprovals ?? 0) ? 'warn' : undefined} />
        </div>
      </div>

      <div className="grid cols-3">
        <Link href="/start/overview" className="card interactive" style={{ display: 'block' }}>
          <div className="label" style={{ marginBottom: 6 }}>1 · Understand</div>
          <b style={{ fontSize: 15 }}>How it works</b>
          <div className="m" style={{ fontSize: 13, marginTop: 6 }}>What the kernel is, how tasks flow, what evidence and approvals mean, and how safe mode protects you.</div>
        </Link>
        <Link href="/start/actions" className="card interactive" style={{ display: 'block' }}>
          <div className="label" style={{ marginBottom: 6 }}>2 · Act</div>
          <b style={{ fontSize: 15 }}>Run a real task</b>
          <div className="m" style={{ fontSize: 13, marginTop: 6 }}>Pick from real action templates. Each creates a real task — no demo, no simulation.</div>
        </Link>
        <Link href="/start/system-map" className="card interactive" style={{ display: 'block' }}>
          <div className="label" style={{ marginBottom: 6 }}>3 · Explore</div>
          <b style={{ fontSize: 15 }}>See what's live</b>
          <div className="m" style={{ fontSize: 13, marginTop: 6 }}>The real service map: roles, domains, security boundaries and registration status.</div>
        </Link>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="label" style={{ marginBottom: 8 }}>Jump to</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/" className="chip">Overview</Link>
          <Link href="/readiness" className="chip">Readiness</Link>
          <Link href="/tasks" className="chip">Tasks</Link>
          <Link href="/evidence/explorer" className="chip">Evidence</Link>
          <Link href="/reports/center" className="chip">Reports</Link>
          <Link href="/security" className="chip">Security</Link>
        </div>
      </div>
    </>
  );
}
