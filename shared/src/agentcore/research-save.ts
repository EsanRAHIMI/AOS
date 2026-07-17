/**
 * K2 D-177 — persist metasearch results into the research provenance ledger
 * so every search that informs a decision can be reopened and verified.
 */
import type { WebSearchResult } from '../research/index.js';
import { saveResearchSource as save } from '../research/providers.js';
import type { ToolExecutionContext } from './registry.js';

export async function saveResearchSource(results: WebSearchResult[], query: string, ctx: ToolExecutionContext): Promise<string[]> {
  const ids: string[] = [];
  for (const r of results.slice(0, 10)) {
    const s = await save({
      url: r.url, canonicalUrl: r.url, title: r.title, publisher: r.publisher, publishedAt: r.publishedAt,
      retrievalMethod: 'searxng', extractedText: '', snippet: r.snippet,
      language: /[؀-ۿ]/.test(`${r.title} ${r.snippet}`) ? 'fa' : 'en', query, runId: ctx.runId, createdBy: ctx.actorId,
    });
    ids.push(s.sourceId);
  }
  return ids;
}
