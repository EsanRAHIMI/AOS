'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Grouped navigation for the glass control-room sidebar. */
const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  { title: 'Operate', items: [['/', 'Overview'], ['/tasks', 'Tasks'], ['/agents', 'Agents'], ['/services', 'Services'], ['/approvals', 'Approvals'], ['/infrastructure', 'Infrastructure']] },
  { title: 'Build', items: [['/capabilities', 'Capabilities'], ['/gaps', 'Gaps'], ['/expansion-proposals', 'Expansions'], ['/evaluations', 'Evaluations'], ['/skills', 'Skills']] },
  { title: 'Reality', items: [['/validations', 'Validations'], ['/github', 'GitHub'], ['/evidence', 'Evidence'], ['/deployment/checklists', 'Checklists'], ['/activations', 'Activations']] },
  { title: 'Runtime', items: [['/monitor', 'Monitor'], ['/incidents', 'Incidents'], ['/repair-tasks', 'Repairs'], ['/repair-diagnoses', 'Diagnoses'], ['/repair-plans', 'Repair Plans']] },
  { title: 'Reason', items: [['/reasoning', 'Reasoning'], ['/strategic-plans', 'Strategic Plans'], ['/policy-decisions', 'Policy'], ['/decision-memory', 'Decisions'], ['/llm/status', 'LLM Status']] },
  { title: 'Govern', items: [['/governance', 'Governance'], ['/outcome-reviews', 'Outcome Reviews'], ['/scoring-profiles', 'Scoring Profiles'], ['/scoring-change-proposals', 'Scoring Proposals'], ['/policy-rules', 'Policy Rules'], ['/rbac', 'RBAC'], ['/audit-logs', 'Audit Logs']] },
  { title: 'Learn', items: [['/learning', 'Learning'], ['/learning-runs', 'Learning Runs'], ['/reliability', 'Reliability'], ['/patterns', 'Patterns'], ['/system-recommendations', 'Recommendations'], ['/improvement-workflows', 'Workflows'], ['/impact-assessments', 'Impact'], ['/memory-maintenance', 'Memory Maint.'], ['/learning/schedules', 'Schedules']] },
  { title: 'More', items: [['/docs', 'Docs'], ['/events', 'Events'], ['/logs', 'Logs'], ['/research', 'Research'], ['/settings', 'Settings']] },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
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
    </aside>
  );
}
