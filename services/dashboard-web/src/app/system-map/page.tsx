import { PageHeader } from '@/components/ui';
import { SystemMap } from '@/components/SystemMap';

export const dynamic = 'force-dynamic';

export default function SystemMapPage() {
  return (
    <>
      <PageHeader title="System Map" subtitle="Every service in the kernel — its role, domain, port, security boundary, and live registration status from the real service registry." />
      <SystemMap />
    </>
  );
}
