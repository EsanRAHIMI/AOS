import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { PageHeader, EmptyState, MetricCard, statusTone } from '@/components/ui';

export const dynamic = 'force-dynamic';

const LADDER: Array<[string, RegExp, string]> = [
  ['Proposed', /proposed/, 'Ideas the kernel wants to build'],
  ['Generated', /generated|building|built/, 'Code produced, awaiting validation'],
  ['Active', /active|live/, 'In production and usable'],
  ['Failed', /failed|rejected/, 'Did not pass the bar'],
];

export default async function CapabilitiesPage() {
  const caps = (await gateway.capabilities()) as Array<Record<string, unknown>> | null;
  const list = caps ?? [];
  const count = (re: RegExp) => list.filter((c) => re.test(String(c.status))).length;

  return (
    <>
      <PageHeader title="Capability Graph" subtitle="What the kernel can do today — and what it has proposed or generated to grow itself." />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {LADDER.map(([label, re]) => (
          <MetricCard key={label} label={label} value={count(re)} tone={label === 'Active' ? 'ok' : label === 'Failed' ? 'err' : label === 'Proposed' ? 'warn' : undefined} />
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card"><EmptyState icon="⬢" title="No capabilities yet" hint="Start the orchestrator to seed the capability graph." /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {LADDER.map(([label, re, hint]) => {
            const group = list.filter((c) => re.test(String(c.status)));
            if (group.length === 0) return null;
            return (
              <div key={label}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                  <span className="label">{label}</span>
                  <span className="m" style={{ fontSize: 12.5 }}>{hint}</span>
                </div>
                <div className="card-grid">
                  {group.map((c, i) => (
                    <Link href={`/capabilities/${String(c.capabilityId)}`} key={i} className="card interactive" style={{ display: 'block' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                        <b style={{ fontSize: 14 }}>{String(c.title)}</b>
                        <span className={`badge ${statusTone(String(c.status))}`}>{String(c.status)}</span>
                      </div>
                      <div className="m" style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span className="chip">{String(c.category)}</span>
                        <span className="chip">maturity {String(c.maturityLevel)}</span>
                        <span className="chip">score {Number(c.evaluationScore ?? 0).toFixed(2)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
