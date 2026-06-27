import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { triggerLearningAction } from '@/app/actions';
import { PageHeader, EmptyState } from '@/components/ui';
export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  const rows = (await gateway.learningSchedules()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader
        title="Learning Schedules"
        subtitle="Continuous learning cadence + triggers. The scheduler is continuous-ready; trigger one now."
        actions={
          <form action={triggerLearningAction}>
            <button className="btn btn-primary" type="submit">Trigger a learning run now</button>
          </form>
        }
      />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✦" title="No schedules" hint="A default daily schedule is seeded once the orchestrator runs." /></div>
      ) : (
        <div className="card-grid">
          {list.map((s, i) => (
            <div className="card" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <b style={{ fontSize: 14.5 }}>{String(s.name)}</b>
                <span className={`badge ${s.enabled ? 'ok' : 'err'}`}>{s.enabled ? 'on' : 'off'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <span className="chip">{String(s.cadence)}</span>
                <span className="chip">{String(s.triggerType)}</span>
                <span className="chip">min {String(s.minNewRecords)} records</span>
              </div>
              <div className="m" style={{ fontSize: 12 }}>Last run: {s.lastRunAt ? timeAgo(String(s.lastRunAt)) : '—'}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
