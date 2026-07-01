import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function VoiceSettingsPage() {
  const [token, memories] = await Promise.all([gateway.voiceRealtimeToken(), gateway.voiceMemories() as Promise<Array<Record<string, unknown>> | null>]);
  const realtime = Boolean(token?.ok);
  const mems = memories ?? [];
  return (
    <>
      <PageHeader title="Voice Settings" subtitle="Realtime voice provider status and the operator's learned preferences. No API keys are ever exposed here." />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Realtime voice" value={realtime ? 'connected' : 'text + browser'} tone={realtime ? 'ok' : 'warn'} hint={realtime ? token?.model ?? 'provider configured' : token?.error ?? 'provider not configured'} />
        <MetricCard label="Text fallback" value="always on" tone="ok" />
        <MetricCard label="Browser voice" value="STT + TTS" hint="native, no key" />
        <MetricCard label="Learned memories" value={mems.length} />
      </div>
      {!realtime && (
        <div className="card" style={{ marginBottom: 16 }}>
          <b style={{ color: 'var(--warn)' }}>Voice provider not configured.</b>
          <span className="m" style={{ fontSize: 13 }}> The dock works fully in text mode plus the browser's built-in speech. Set <code>VOICE_PROVIDER</code>, <code>VOICE_MODEL</code> and <code>OPENAI_API_KEY</code> on the voice-operator-agent to enable realtime WebRTC voice — the key stays server-side; only a short-lived ephemeral token reaches the browser.</span>
        </div>
      )}
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Learned preferences &amp; guardrails</div>
        {mems.length === 0 ? (
          <EmptyState icon="✦" title="Nothing learned yet" hint="Use the voice operator and it will remember preferences, mappings and mistakes to avoid." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mems.map((m, i) => (
              <div key={i} className="glass" style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13 }}>{String(m.content)}</span>
                <span className={`badge ${m.kind === 'mistake_avoidance' ? 'warn' : 'ok'}`}>{String(m.kind)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
