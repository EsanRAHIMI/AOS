import Link from 'next/link';
import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function RepairTaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = (await gateway.repairTaskDetail(id)) as Record<string, unknown> | null;
  if (!r) return (<><h1 className="h1">Repair Task</h1><div className="card"><div className="empty">Not found.</div></div></>);
  return (
    <>
      <h1 className="h1">Repair Task · {String(r.serviceName)}</h1>
      <p className="sub"><span className="badge warn">{String(r.status)}</span> · attempts {String(r.attempts ?? 0)}</p>
      <div className="card">
        <table><tbody>
          <tr><td className="m" style={{ width: 170 }}>Diagnosis</td><td>{String(r.diagnosis)}</td></tr>
          <tr><td className="m">Proposed fix</td><td>{String(r.proposedFix)}</td></tr>
          <tr><td className="m">Recommended action</td><td>{String(r.recommendedAction)}</td></tr>
          <tr><td className="m">Requires approval</td><td>{r.requiresApproval ? 'yes' : 'no'}</td></tr>
          <tr><td className="m">Incident</td><td className="m"><Link href={`/incidents/${String(r.incidentId)}`}>{String(r.incidentId)}</Link></td></tr>
        </tbody></table>
      </div>
    </>
  );
}
