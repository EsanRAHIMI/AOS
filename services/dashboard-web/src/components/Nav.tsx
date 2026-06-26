import Link from 'next/link';

const ROUTES: Array<[string, string]> = [
  ['/', 'Overview'],
  ['/agents', 'Agents'],
  ['/services', 'Services'],
  ['/tasks', 'Tasks'],
  ['/capabilities', 'Capabilities'],
  ['/gaps', 'Gaps'],
  ['/expansion-proposals', 'Expansions'],
  ['/evaluations', 'Evaluations'],
  ['/skills', 'Skills'],
  ['/llm-traces', 'LLM Traces'],
  ['/validations', 'Validations'],
  ['/github', 'GitHub'],
  ['/evidence', 'Evidence'],
  ['/deployment/checklists', 'Checklists'],
  ['/activations', 'Activations'],
  ['/monitor', 'Monitor'],
  ['/incidents', 'Incidents'],
  ['/repair-tasks', 'Repairs'],
  ['/repair-diagnoses', 'Diagnoses'],
  ['/repair-plans', 'Repair Plans'],
  ['/reasoning', 'Reasoning'],
  ['/strategic-plans', 'Strategic Plans'],
  ['/policy-decisions', 'Policy'],
  ['/decision-memory', 'Decisions'],
  ['/governance', 'Governance'],
  ['/outcome-reviews', 'Outcome Reviews'],
  ['/scoring-profiles', 'Scoring Profiles'],
  ['/scoring-change-proposals', 'Scoring Proposals'],
  ['/policy-rules', 'Policy Rules'],
  ['/rbac', 'RBAC'],
  ['/audit-logs', 'Audit Logs'],
  ['/llm/status', 'LLM Status'],
  ['/infrastructure', 'Infrastructure'],
  ['/approvals', 'Approvals'],
  ['/memory', 'Memory'],
  ['/docs', 'Docs'],
  ['/events', 'Events'],
  ['/logs', 'Logs'],
  ['/research', 'Research'],
  ['/settings', 'Settings'],
];

export function Nav() {
  return (
    <nav className="nav">
      {ROUTES.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
