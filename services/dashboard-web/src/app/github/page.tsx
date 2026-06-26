import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
export const dynamic = 'force-dynamic';

const badgeFor = (s: string) => (s === 'pr_open' || s === 'pushed' ? 'ok' : s === 'failed' ? 'err' : 'warn');

export default async function GitHubPage() {
  const rows = (await gateway.githubOps()) as Array<Record<string, unknown>> | null;
  return (
    <>
      <h1 className="h1">GitHub Delivery</h1>
      <p className="sub">Branches, commits and PRs the kernel produced for generated services.</p>
      <div className="card">
        {!rows || rows.length === 0 ? (
          <div className="empty">No GitHub operations yet.</div>
        ) : (
          <table>
            <thead><tr><th>Service</th><th>Branch</th><th>Mode</th><th>Status</th><th>Files</th><th>PR</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((o, i) => (
                <tr key={i}>
                  <td>{String(o.serviceName)}</td>
                  <td className="m">{String(o.branchName)}</td>
                  <td className="m">{String(o.mode)}</td>
                  <td><span className={`badge ${badgeFor(String(o.status))}`}>{String(o.status)}</span></td>
                  <td className="m">{Array.isArray(o.filesChanged) ? (o.filesChanged as string[]).length : 0}</td>
                  <td className="m">{o.pullRequestUrl ? <a href={String(o.pullRequestUrl)}>PR</a> : '—'}</td>
                  <td className="m">{timeAgo(String(o.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
