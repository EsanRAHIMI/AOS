import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function VoiceSessionsPage() {
  const rows = (await gateway.voiceSessions()) as Array<Record<string, unknown>> | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Voice Sessions" subtitle="Recent voice operator sessions, their tool calls and permissions — fully audited." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="🎙" title="No voice sessions yet" hint="Open the floating dock and ask “What is happening now?” to start." /></div>
      ) : (
        <div className="card-grid">
          {list.map((s, i) => (
            <div className="card" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <b style={{ fontSize: 13.5 }}>{String(s.role)} · {String(s.provider)}</b>
                <span className={`badge ${s.status === 'active' ? 'ok' : ''}`}>{String(s.status)}</span>
              </div>
              <div className="m" style={{ fontSize: 12.5 }}>{String(s.currentPage)} · started {timeAgo(String(s.startedAt))}</div>
              {s.transcriptSummary ? <div className="m" style={{ fontSize: 12.5, marginTop: 6 }}>{String(s.transcriptSummary)}</div> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
