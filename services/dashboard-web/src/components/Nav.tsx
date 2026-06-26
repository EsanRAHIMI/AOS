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
