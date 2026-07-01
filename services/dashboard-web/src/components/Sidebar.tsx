'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/login/actions';

/** Grouped navigation for the glass control-room sidebar. */
const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  { title: 'Get started', items: [['/', 'Overview'], ['/start', 'Start guide'], ['/voice', 'Voice Operator'], ['/system-map', 'System map'], ['/readiness', 'Readiness']] },
  { title: 'Operate', items: [['/tasks', 'Tasks'], ['/start/actions', 'Action templates'], ['/agents', 'Agents'], ['/services', 'Services'], ['/approvals', 'Approvals'], ['/infrastructure', 'Infrastructure']] },
  { title: 'Build', items: [['/capabilities', 'Capabilities'], ['/gaps', 'Missing Capabilities'], ['/expansion-proposals', 'Expansions'], ['/evaluations', 'Evaluations'], ['/skills', 'Skills']] },
  { title: 'Reality', items: [['/validations', 'Validations'], ['/github', 'GitHub'], ['/evidence/explorer', 'Proof & Evidence'], ['/deployment/checklists', 'Checklists'], ['/activations', 'Live Activation']] },
  { title: 'Runtime', items: [['/monitor', 'Monitor'], ['/incidents', 'Incidents'], ['/repair-tasks', 'Repair Actions'], ['/repair-diagnoses', 'Diagnoses'], ['/repair-plans', 'Repair Plans']] },
  { title: 'Reason', items: [['/reasoning', 'Reasoning'], ['/strategic-plans', 'Strategic Plans'], ['/policy-decisions', 'Policy'], ['/decision-memory', 'Decisions'], ['/llm/status', 'LLM Status']] },
  { title: 'Govern', items: [['/governance', 'Governance'], ['/outcome-reviews', 'Outcome Reviews'], ['/scoring-profiles', 'Scoring Profiles'], ['/scoring-change-proposals', 'Scoring Proposals'], ['/policy-rules', 'Policy Rules'], ['/rbac', 'RBAC'], ['/audit-logs', 'Audit Logs']] },
  { title: 'Intelligence', items: [['/llm', 'Real Intelligence'], ['/llm/costs', 'AI Costs & Budget'], ['/llm/prompts', 'Agent Prompts'], ['/llm-traces', 'AI Reasoning Traces'], ['/research', 'Research'], ['/reviews', 'Reviews'], ['/qa', 'QA'], ['/reports/center', 'Reports Center']] },
  { title: 'Secure', items: [['/security', 'Security'], ['/security/events', 'Security Events'], ['/security/env', 'Env Health'], ['/security/rate-limits', 'Rate Limits'], ['/security/safe-mode', 'Safe Mode']] },
  { title: 'Learn', items: [['/learning', 'Learning'], ['/learning-runs', 'Learning Runs'], ['/reliability', 'Reliability'], ['/patterns', 'Patterns'], ['/system-recommendations', 'Recommendations'], ['/improvement-workflows', 'Workflows'], ['/impact-assessments', 'Impact'], ['/memory-maintenance', 'Memory Maint.'], ['/learning/schedules', 'Schedules']] },
  { title: 'More', items: [['/docs', 'Docs'], ['/events', 'Events'], ['/logs', 'Logs'], ['/settings', 'Settings']] },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ user }: { user?: { email: string; role: string } }) {
  const pathname = usePathname() ?? '/';
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo" />
        <span>
          FACTORY
          <small>autonomous-os-kernel</small>
        </span>
      </div>
      <nav className="nav">
        {GROUPS.map((g) => (
          <div className="nav-group" key={g.title}>
            <div className="nav-title">{g.title}</div>
            {g.items.map(([href, label]) => (
              <Link key={href} href={href} className={isActive(pathname, href) ? 'active' : ''}>
                {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      {user && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text)', wordBreak: 'break-all' }}>{user.email}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
            <span className={`badge ${user.role === 'owner' ? 'ok' : user.role === 'viewer' ? '' : 'warn'}`}>{user.role}</span>
            <form action={logoutAction}>
              <button type="submit" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }}>Sign out</button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
