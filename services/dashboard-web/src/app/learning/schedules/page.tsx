import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { triggerLearningAction } from '@/app/actions';
export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  const rows = (await gateway.learningSchedules()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Learning Schedules</h1>
      <p className="sub">Continuous learning cadence + triggers. The scheduler is continuous-ready; trigger one now below.</p>
      <form action={triggerLearningAction} style={{ marginBottom: 16 }}>
        <button className="btn-ok" type="submit">Trigger a learning run now</button>
      </form>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No schedules.</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Cadence</th><th>Trigger</th><th>Min new records</th><th>Enabled</th><th>Last run</th></tr></thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={i}>
                  <td>{String(s.name)}</td>
                  <td className="m">{String(s.cadence)}</td>
                  <td className="m">{String(s.triggerType)}</td>
                  <td className="m">{String(s.minNewRecords)}</td>
                  <td><span className={`badge ${s.enabled ? 'ok' : 'err'}`}>{s.enabled ? 'on' : 'off'}</span></td>
                  <td className="m">{s.lastRunAt ? timeAgo(String(s.lastRunAt)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
