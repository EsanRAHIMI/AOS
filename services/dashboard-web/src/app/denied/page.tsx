import Link from 'next/link';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const LABEL: Record<string, string> = {
  createTask: 'create a task', decideApproval: 'decide an approval', decideScoringProposal: 'approve a scoring change',
  decidePolicyProposal: 'approve a policy change', decideRecommendation: 'approve a recommendation', decideExpansion: 'approve an expansion',
  confirmInfra: 'confirm infrastructure', confirmChecklist: 'confirm a deployment', runActivation: 'run an activation check',
  decideRepairPlan: 'decide a repair plan', revalidateIncident: 'revalidate an incident', triggerLearning: 'trigger a learning run',
  runSecurityCheck: 'run a security check', setSafeMode: 'change safe mode',
};

export default async function DeniedPage({ searchParams }: { searchParams: Promise<{ reason?: string; action?: string }> }) {
  const { reason, action } = await searchParams;
  const session = await getSession();
  const what = action ? (LABEL[action] ?? action) : 'that action';
  const safeMode = reason === 'safe_mode';

  return (
    <div className="card error-card" role="alert" style={{ maxWidth: 560, margin: '40px auto' }}>
      <div className="empty-state">
        <div className="ic" style={{ color: 'var(--err)' }}>🔒</div>
        <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 16 }}>
          {safeMode ? 'Blocked by safe mode' : 'Action not permitted'}
        </div>
        <div className="m" style={{ marginTop: 6 }}>
          {safeMode
            ? <>Safe mode is active, so the kernel is refusing to {what}. Mutating actions are disabled until an owner turns safe mode off.</>
            : <>Your role (<b>{session?.role ?? 'unknown'}</b>) is not permitted to {what}. This attempt was recorded in the security trail.</>}
        </div>
      </div>
      <div className="actions" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary" href="/">Back to overview</Link>
        {safeMode ? <Link className="btn btn-ghost" href="/security/safe-mode">Safe mode</Link> : <Link className="btn btn-ghost" href="/security/events">Security events</Link>}
      </div>
    </div>
  );
}
