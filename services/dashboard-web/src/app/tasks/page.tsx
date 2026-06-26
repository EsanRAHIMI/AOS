import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { CreateTaskForm } from '@/components/CreateTaskForm';
import { PageHeader, MetricCard, EmptyState, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const tasks = (await gateway.tasks()) as Array<Record<string, unknown>> | null;
  const list = tasks ?? [];
  const count = (re: RegExp) => list.filter((t) => re.test(String(t.status))).length;

  return (
    <>
      <PageHeader title="Tasks" subtitle="Give the kernel a goal and watch the autonomous pipeline plan, build, validate, and report — live." />

      <div className="card" style={{ marginBottom: 16 }}>
        <CreateTaskForm variant="command" />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Total" value={list.length} />
        <MetricCard label="Running" value={count(/running|planning|queued/)} tone="warn" />
        <MetricCard label="Awaiting you" value={count(/awaiting|approval/)} tone={count(/awaiting|approval/) ? 'warn' : undefined} />
        <MetricCard label="Completed" value={count(/completed/)} tone="ok" />
      </div>

      {list.length === 0 ? (
        <div className="card"><EmptyState icon="◇" title="No tasks yet" hint="Use the command box above to create your first goal." /></div>
      ) : (
        <div className="card-grid">
          {list.map((t, i) => (
            <Link href={`/tasks/${String(t.taskId)}`} key={i} className="card interactive" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                <b style={{ fontSize: 14.5, lineHeight: 1.35 }}>{String(t.goal)}</b>
                <StatusPill status={String(t.status)} />
              </div>
              <div className="m" style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="chip">{String(t.assignedServiceId ?? 'unassigned')}</span>
                <span>{timeAgo(String(t.createdAt))}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
