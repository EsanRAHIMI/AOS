import { gateway } from '@/lib/gateway';
import { LiveEvents } from '@/components/LiveEvents';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const rows = (await gateway.events(100)) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Events</h1>
      <p className="sub">Live stream plus recent history from the event bus.</p>
      <div className="grid cols-2">
        <LiveEvents />
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Recent history</div>
          {!rows || rows.length === 0 ? (
            <div className="empty">No events recorded yet.</div>
          ) : (
            <div className="feed">
              {rows.map((e, i) => (
                <div key={i}><span className="t">{String(e.type)}</span> <span className="m">· {String(e.source)} · {timeAgo(String(e.createdAt))}</span></div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
