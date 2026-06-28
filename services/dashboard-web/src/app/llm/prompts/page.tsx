import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface Prompt {
  promptKey: string; agentId: string; version: string; status: string; role: string;
  allowedActions: string[]; forbiddenActions: string[]; outputSchema: string;
  evidenceRequired: boolean; approvalRequired: boolean; policyConstraints: string[];
  fallbackBehavior: string; changelog: string[];
}

export default async function PromptsPage() {
  const rows = (await gateway.llmPrompts()) as Prompt[] | null;
  const list = rows ?? [];
  return (
    <>
      <PageHeader title="Agent Prompts" subtitle="Versioned reasoning contracts: each agent's role, allowed/forbidden actions, output schema, and evidence/approval/policy requirements." />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon="✦" title="No prompts" /></div>
      ) : (
        <div className="card-grid">
          {list.map((p) => (
            <div className="card" key={p.promptKey}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <b style={{ fontSize: 13.5 }}>{p.promptKey}</b>
                <span className={`badge ${p.status === 'active' ? 'ok' : ''}`}>{p.version}</span>
              </div>
              <div className="m" style={{ fontSize: 12.5, marginBottom: 8 }}>{p.role}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="chip">schema: {p.outputSchema}</span>
                {p.evidenceRequired && <span className="chip">evidence</span>}
                {p.approvalRequired && <span className="badge warn">approval</span>}
              </div>
              <details>
                <summary className="m" style={{ fontSize: 12.5, cursor: 'pointer' }}>Contract &amp; changelog</summary>
                <div style={{ fontSize: 12.5, marginTop: 8 }}>
                  <div className="m"><b>Allowed:</b> {p.allowedActions.join(', ')}</div>
                  <div className="m" style={{ marginTop: 4 }}><b>Forbidden:</b> {p.forbiddenActions.join(', ')}</div>
                  {p.policyConstraints.length > 0 && <div className="m" style={{ marginTop: 4 }}><b>Policy:</b> {p.policyConstraints.join('; ')}</div>}
                  <div className="m" style={{ marginTop: 4 }}><b>Fallback:</b> {p.fallbackBehavior}</div>
                  <div className="m" style={{ marginTop: 4 }}><b>Changelog:</b> {p.changelog.join(' · ')}</div>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
