import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

const tone = (r: string) => (r === 'critical' || r === 'high' ? 'err' : r === 'medium' ? 'warn' : 'ok');

export default async function SecurityEnvPage() {
  const env = await gateway.securityEnv();
  if (!env) {
    return (
      <>
        <PageHeader title="Environment & Secret Health" subtitle="Checks that required configuration is present, strong, and not placeholder." />
        <div className="card"><EmptyState icon="🛡" title="Gateway unreachable" hint="Could not run the environment audit." /></div>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Environment & Secret Health"
        subtitle="Checks that required configuration is present, strong, and not a placeholder. Secrets are never displayed — only their status."
        actions={<span className={`badge ${env.passed ? 'ok' : tone(env.riskLevel)}`}>{env.passed ? 'all required checks pass' : `${env.riskLevel} risk`}</span>}
      />
      <div className="card-grid" style={{ marginBottom: 16 }}>
        {env.checks.map((c) => (
          <div className="card" key={c.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 6 }}>
              <b style={{ fontSize: 13.5 }}>{c.label}</b>
              <span className={`badge ${c.passed ? 'ok' : tone(c.severity)}`}>{c.passed ? 'ok' : c.severity}</span>
            </div>
            <div className="m" style={{ fontSize: 12.5 }}>{c.detail}</div>
          </div>
        ))}
      </div>
      {env.recommendations.length > 0 && (
        <div className="card">
          <div className="label" style={{ marginBottom: 8 }}>Recommendations</div>
          <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
            {env.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
