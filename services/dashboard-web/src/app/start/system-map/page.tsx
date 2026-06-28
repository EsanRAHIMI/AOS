import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { SystemMap } from '@/components/SystemMap';

export const dynamic = 'force-dynamic';

export default function StartSystemMapPage() {
  return (
    <>
      <PageHeader
        title="What's live"
        subtitle="The real services that make up the kernel — roles, domains, security boundaries and live registration status."
        crumbs={[['/start', 'Start'], ['/start/system-map', "What's live"]]}
        actions={<Link href="/start/actions" className="btn btn-primary">Run a task</Link>}
      />
      <SystemMap />
    </>
  );
}
