import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { CreateTaskForm } from '@/components/CreateTaskForm';
export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const tasks = (await gateway.tasks()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Tasks</h1>
      <p className="sub">Create a goal and watch the autonomous pipeline execute live.</p>
      <CreateTaskForm />
      <div className="card">
        {!tasks || tasks.length === 0 ? (
          <div className="empty">No tasks yet. Create one above.</div>
        ) : (
          <table>
            <thead><tr><th>Goal</th><th>Status</th><th>Assigned</th><th>Created</th></tr></thead>
            <tbody>
              {tasks.map((t, i) => {
                const status = String(t.status);
                const cls = status === 'completed' ? 'ok' : status === 'failed' || status === 'cancelled' ? 'err' : status === 'awaiting_approval' ? 'warn' : '';
                return (
                  <tr key={i}>
                    <td><Link href={`/tasks/${String(t.taskId)}`}>{String(t.goal)}</Link></td>
                    <td><span className={`badge ${cls}`}>{status}</span></td>
                    <td className="m">{String(t.assignedServiceId ?? '—')}</td>
                    <td className="m">{timeAgo(String(t.createdAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
