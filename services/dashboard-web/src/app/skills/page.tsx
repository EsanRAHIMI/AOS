import { gateway } from '@/lib/gateway';
export const dynamic = 'force-dynamic';

export default async function SkillsPage() {
  const rows = (await gateway.skills()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">Skill Library</h1>
      <p className="sub">Reusable operational patterns learned from successful tasks.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No skills learned yet. Complete an expansion to extract one.</div>
        ) : (
          <table>
            <thead><tr><th>Skill</th><th>Category</th><th>Steps</th><th>Uses</th><th>Success</th></tr></thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={i}>
                  <td>{String(s.title)}</td>
                  <td className="m">{String(s.category)}</td>
                  <td className="m">{Array.isArray(s.steps) ? (s.steps as string[]).length : 0}</td>
                  <td>{String(s.usageCount ?? 0)}</td>
                  <td>{Number(s.successRate ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
