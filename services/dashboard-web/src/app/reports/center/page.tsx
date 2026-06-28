import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { timeAgo } from '@/lib/format';
import { PageHeader, EmptyState, MetricCard } from '@/components/ui';
import { ReportTools } from '@/components/ReportTools';

export const dynamic = 'force-dynamic';

interface Item { kind: string; title: string; summary: string; taskId?: string; createdAt: string; markdown: string; mode?: string; passed?: boolean }

export default async function ReportsCenterPage() {
  const [intel, research, reviews, qa, security, learning] = await Promise.all([
    gateway.reports() as Promise<Array<Record<string, unknown>> | null>,
    gateway.research() as Promise<Array<Record<string, unknown>> | null>,
    gateway.reviews() as Promise<Array<Record<string, unknown>> | null>,
    gateway.qa() as Promise<Array<Record<string, unknown>> | null>,
    gateway.securityChecks() as Promise<Array<Record<string, unknown>> | null>,
    gateway.learningRuns() as Promise<Array<Record<string, unknown>> | null>,
  ]);

  const items: Item[] = [];
  for (const r of intel ?? []) items.push({ kind: 'Intelligence', title: String(r.title), summary: String(r.headline), taskId: r.taskId ? String(r.taskId) : undefined, createdAt: String(r.createdAt), mode: String(r.mode), markdown: `# ${r.title}\n\n${r.headline}\n\n${(r.sections as Array<{ heading: string; body: string }> ?? []).map((s) => `## ${s.heading}\n${s.body}`).join('\n\n')}` });
  for (const r of research ?? []) items.push({ kind: 'Research', title: String(r.topic), summary: String(r.summary), taskId: r.taskId ? String(r.taskId) : undefined, createdAt: String(r.createdAt), mode: String(r.mode), markdown: `# Research: ${r.topic}\n\n${r.summary}\n\n## Findings\n${(r.findings as string[] ?? []).map((f) => `- ${f}`).join('\n')}` });
  for (const r of reviews ?? []) items.push({ kind: 'Review', title: `Review · ${r.target}`, summary: `${r.passed ? 'Passed' : 'Failed'} · ${(r.issues as unknown[] ?? []).length} issues`, taskId: r.taskId ? String(r.taskId) : undefined, createdAt: String(r.createdAt), passed: Boolean(r.passed), markdown: `# Review: ${r.target}\n\nResult: ${r.passed ? 'PASSED' : 'FAILED'}\n\n## Required fixes\n${(r.requiredFixes as string[] ?? []).map((f) => `- ${f}`).join('\n') || '- none'}` });
  for (const r of qa ?? []) items.push({ kind: 'QA', title: `QA · ${String(r.goal).slice(0, 60)}`, summary: String(r.verdict), taskId: r.taskId ? String(r.taskId) : undefined, createdAt: String(r.createdAt), passed: Boolean(r.passed), markdown: `# QA\n\n${r.verdict}\n\n## Criteria\n${(r.criteria as Array<{ criterion: string; met: boolean }> ?? []).map((c) => `- [${c.met ? 'x' : ' '}] ${c.criterion}`).join('\n')}` });
  for (const r of security ?? []) items.push({ kind: 'Security', title: `Security check · ${r.target}`, summary: `${r.passed ? 'Passed' : 'Found issues'} (${r.riskLevel})`, createdAt: String(r.createdAt), passed: Boolean(r.passed), markdown: `# Security check\n\nResult: ${r.passed ? 'PASSED' : `${r.riskLevel} risk`}\n\n## Recommendations\n${(r.recommendations as string[] ?? []).map((f) => `- ${f}`).join('\n') || '- none'}` });
  for (const r of learning ?? []) items.push({ kind: 'Learning', title: 'Learning run', summary: String(r.summary ?? 'Analyzed system history'), taskId: r.taskId ? String(r.taskId) : undefined, createdAt: String(r.createdAt), markdown: `# Learning run\n\n${r.summary ?? ''}` });

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const counts = items.reduce<Record<string, number>>((acc, i) => { acc[i.kind] = (acc[i.kind] ?? 0) + 1; return acc; }, {});
  const toneFor = (i: Item) => (i.passed === false ? 'err' : i.mode === 'real' ? 'ok' : '');

  return (
    <>
      <PageHeader title="Reports Center" subtitle="Every real report the kernel has produced — intelligence, research, review, QA, security and learning — in one place. Copy as markdown or print." />
      {items.length === 0 ? (
        <div className="card"><EmptyState icon="✦" title="No reports yet" hint='Run "Generate an operational intelligence report" or a research task, then come back.' /></div>
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <MetricCard label="Total reports" value={items.length} />
            <MetricCard label="Intelligence" value={counts.Intelligence ?? 0} />
            <MetricCard label="Research" value={counts.Research ?? 0} />
            <MetricCard label="Security" value={counts.Security ?? 0} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {items.map((it, i) => (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                  <div><span className="chip" style={{ marginRight: 8 }}>{it.kind}</span><b style={{ fontSize: 14 }}>{it.title}</b></div>
                  <span className={`badge ${toneFor(it)}`}>{it.passed === false ? 'failed' : it.mode ?? 'report'}</span>
                </div>
                <div className="m" style={{ fontSize: 13, marginBottom: 8 }}>{it.summary}</div>
                <div className="m" style={{ fontSize: 12, marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {it.taskId ? <Link href={`/tasks/${it.taskId}`} className="chip">source task</Link> : null}
                  <span>{timeAgo(it.createdAt)}</span>
                </div>
                <details><summary className="m" style={{ fontSize: 12.5, cursor: 'pointer' }}>Markdown</summary><pre className="feed" style={{ whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 12 }}>{it.markdown}</pre></details>
                <div style={{ marginTop: 10 }}><ReportTools markdown={it.markdown} /></div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
