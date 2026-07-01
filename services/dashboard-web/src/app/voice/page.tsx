import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function VoicePage() {
  const [sessions, memories, calls] = await Promise.all([
    gateway.voiceSessions() as Promise<unknown[] | null>,
    gateway.voiceMemories() as Promise<unknown[] | null>,
    gateway.voiceToolCalls() as Promise<unknown[] | null>,
  ]);
  return (
    <>
      <PageHeader title="Voice Operator" subtitle="Your always-available operator copilot. Speak or type from the floating dock on any page — it explains, asks before acting, executes only through safe approved tools, and learns." actions={<Link href="/voice/settings" className="btn btn-ghost">Settings</Link>} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="Sessions" value={(sessions ?? []).length} />
        <MetricCard label="Tool calls" value={(calls ?? []).length} />
        <MetricCard label="Learned memories" value={(memories ?? []).length} />
        <MetricCard label="Dock" value="floating" hint="on every page" tone="ok" />
      </div>
      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Try saying</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['What is happening now?', 'Check gateway health', 'Restart the gateway', 'Analyze system history', 'Run a security check', 'Research best practices for dashboard security'].map((q) => <span key={q} className="chip">“{q}”</span>)}
        </div>
        <div className="m" style={{ fontSize: 12.5, marginTop: 10 }}>
          Read questions answer immediately. Low-risk actions ask a quick confirm. Medium/high actions need approval; protected core needs OWNER approval on the Overview. Safe mode blocks mutations. <Link href="/voice/sessions">View sessions →</Link>
        </div>
      </div>
      {(memories ?? []).length === 0 && (
        <div className="card" style={{ marginTop: 16 }}><EmptyState icon="✦" title="No learned memories yet" hint="As you use the voice operator, it remembers your preferences and the mistakes to avoid." /></div>
      )}
    </>
  );
}
