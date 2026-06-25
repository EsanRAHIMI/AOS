import Link from 'next/link';

const ROUTES: Array<[string, string]> = [
  ['/', 'Overview'],
  ['/agents', 'Agents'],
  ['/services', 'Services'],
  ['/tasks', 'Tasks'],
  ['/infrastructure', 'Infrastructure'],
  ['/approvals', 'Approvals'],
  ['/memory', 'Memory'],
  ['/skills', 'Skills'],
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
