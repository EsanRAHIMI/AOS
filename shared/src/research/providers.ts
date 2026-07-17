/**
 * Independent Research Stack (K2, D-177; mandate §G) — no paid search APIs.
 *
 * Self-hostable retrieval: SearXNG metasearch (preferred), direct URL fetch,
 * RSS/Atom, sitemap discovery, dependency-free HTML extraction, Mongo-backed
 * caching + dedup, and a provenance ledger (`research_sources`) storing both
 * publication date and retrieval date so findings can be reopened and
 * verified. Tavily remains a strictly OPTIONAL adapter (../index.ts) — never
 * a runtime requirement; when neither SearXNG nor Tavily is configured,
 * direct-source research still works and the UI shows reduced coverage
 * honestly.
 *
 * Injection posture: everything fetched here is UNTRUSTED DATA. Tools built
 * on this module declare `outputTrust: 'untrusted_external'`; the agent loop
 * fences such output before any model sees it (agentcore/loop.ts
 * fenceUntrusted). Robots.txt disallow rules are respected on direct fetch;
 * no auth walls, paywalls or CAPTCHAs are ever bypassed.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { IsoDate } from '../schemas/common.js';
import { estimateReliability, type WebSearchResult } from './index.js';

/* ------------------------------ provenance ------------------------------- */

export const RetrievedSourceSchema = z.object({
  sourceId: z.string(),
  url: z.string(),
  canonicalUrl: z.string().default(''),
  title: z.string().default(''),
  publisher: z.string().default(''),
  /** As published by the source (may be empty — honestly unknown). */
  publishedAt: z.string().default(''),
  /** When WE retrieved it — always present. */
  retrievedAt: IsoDate,
  retrievalMethod: z.enum(['searxng', 'direct_fetch', 'rss', 'sitemap', 'tavily_optional', 'github_api']),
  contentHash: z.string().default(''),
  /** Extracted readable text (capped) — the evidence behind claims. */
  extractedText: z.string().default(''),
  snippet: z.string().default(''),
  reliability: z.enum(['high', 'medium', 'low']).default('medium'),
  freshnessDays: z.number().nullable().default(null),
  language: z.string().default(''),
  query: z.string().default(''),
  runId: z.string().nullable().default(null),
  createdBy: z.string().default('system'),
});
export type RetrievedSource = z.infer<typeof RetrievedSourceSchema>;

const sources = () => collection<RetrievedSource>(COLLECTIONS.RESEARCH_SOURCES);

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Cache/dedup: same URL retrieved within ttlHours → reuse the ledger row. */
export async function findCachedSource(url: string, ttlHours = 24): Promise<RetrievedSource | null> {
  const cutoff = new Date(Date.now() - ttlHours * 3600_000).toISOString();
  return sources().findOne({ url, retrievedAt: { $gt: cutoff } } as never, { projection: { _id: 0 } as never });
}

export async function saveResearchSource(args: Omit<RetrievedSource, 'sourceId' | 'retrievedAt' | 'reliability' | 'freshnessDays' | 'contentHash'> & { retrievedAt?: string }): Promise<RetrievedSource> {
  const retrievedAt = args.retrievedAt ?? nowIso();
  const freshnessDays = args.publishedAt ? Math.max(0, Math.round((Date.parse(retrievedAt) - Date.parse(args.publishedAt)) / 86_400_000)) : null;
  const source: RetrievedSource = RetrievedSourceSchema.parse({
    ...args,
    sourceId: genId('rsrc'),
    retrievedAt,
    contentHash: sha256(args.extractedText || args.snippet || args.url),
    reliability: estimateReliability(args.url),
    freshnessDays: Number.isFinite(freshnessDays as number) ? freshnessDays : null,
  });
  // Dedup on content: identical hash for the same URL → refresh, don't duplicate.
  const dup = await sources().findOne({ url: source.url, contentHash: source.contentHash } as never);
  if (dup) {
    await sources().updateOne({ sourceId: dup.sourceId }, { $set: { retrievedAt } });
    return { ...dup, retrievedAt };
  }
  await sources().insertOne(source);
  return source;
}

export async function getResearchSource(sourceId: string): Promise<RetrievedSource | null> {
  return sources().findOne({ sourceId }, { projection: { _id: 0 } as never });
}

/* ------------------------------- extraction ------------------------------ */

/** Dependency-free readable-text extraction. Not Readability-grade — honest
 *  about that — but removes script/style/nav noise and yields usable text. */
export function extractReadableText(html: string, maxChars = 20000): { title: string; description: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim().slice(0, 300) ?? '';
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.slice(0, 500)
    ?? /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.slice(0, 500)
    ?? '';
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  t = t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2).join('\n');
  return { title, description, text: t.slice(0, maxChars) };
}

/** Extract publication date from common meta tags — empty when unknown. */
export function extractPublishedAt(html: string): string {
  const m = /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']*)["']/i.exec(html)
    ?? /<meta[^>]+name=["'](?:date|publish-date|publication_date)["'][^>]+content=["']([^"']*)["']/i.exec(html)
    ?? /<time[^>]+datetime=["']([^"']*)["']/i.exec(html);
  return m?.[1]?.slice(0, 30) ?? '';
}

/* ------------------------------ robots.txt ------------------------------- */

const robotsCache = new Map<string, { fetchedAt: number; disallows: string[] }>();

/** Minimal robots.txt honor: User-agent:* Disallow rules. Fail-open on fetch
 *  error (standard practice), fail-closed on explicit disallow. */
export async function robotsAllows(url: string, timeoutMs = 5000): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const key = u.origin;
  let entry = robotsCache.get(key);
  if (!entry || Date.now() - entry.fetchedAt > 3600_000) {
    let disallows: string[] = [];
    try {
      const res = await fetch(`${key}/robots.txt`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (res.ok) {
        const text = await res.text();
        let inStar = false;
        for (const raw of text.split('\n')) {
          const line = raw.replace(/#.*$/, '').trim();
          const ua = /^user-agent:\s*(.+)$/i.exec(line);
          if (ua) { inStar = (ua[1] ?? '').trim() === '*'; continue; }
          const dis = /^disallow:\s*(.*)$/i.exec(line);
          if (dis && inStar) {
            const path = (dis[1] ?? '').trim();
            if (path) disallows.push(path);
          }
        }
      }
    } catch { disallows = []; }
    entry = { fetchedAt: Date.now(), disallows };
    robotsCache.set(key, entry);
  }
  const path = u.pathname || '/';
  return !entry.disallows.some((d) => path.startsWith(d));
}

/* ------------------------------ direct fetch ----------------------------- */

export interface FetchedPage {
  url: string;
  status: number;
  title: string;
  description: string;
  text: string;
  publishedAt: string;
  fromCache: boolean;
  source: RetrievedSource | null;
  blockedByRobots: boolean;
  error: string;
}

export async function fetchAndExtract(url: string, opts: { runId?: string | null; query?: string; actorId?: string; cacheTtlHours?: number; timeoutMs?: number } = {}): Promise<FetchedPage> {
  const cached = await findCachedSource(url, opts.cacheTtlHours ?? 24);
  if (cached) {
    return { url, status: 200, title: cached.title, description: '', text: cached.extractedText, publishedAt: cached.publishedAt, fromCache: true, source: cached, blockedByRobots: false, error: '' };
  }
  if (!(await robotsAllows(url))) {
    return { url, status: 0, title: '', description: '', text: '', publishedAt: '', fromCache: false, source: null, blockedByRobots: true, error: 'disallowed by robots.txt' };
  }
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      redirect: 'follow',
      headers: { 'user-agent': 'AOS-Research/1.0 (+self-hosted personal research; respects robots.txt)' },
    });
    const html = await res.text();
    if (!res.ok) {
      return { url, status: res.status, title: '', description: '', text: '', publishedAt: '', fromCache: false, source: null, blockedByRobots: false, error: `HTTP ${res.status}` };
    }
    const { title, description, text } = extractReadableText(html);
    const publishedAt = extractPublishedAt(html);
    const source = await saveResearchSource({
      url, canonicalUrl: res.url || url, title, publisher: hostnameOf(url), publishedAt,
      retrievalMethod: 'direct_fetch', extractedText: text, snippet: description || text.slice(0, 400),
      language: /[؀-ۿ]/.test(text) ? 'fa' : 'en', query: opts.query ?? '', runId: opts.runId ?? null, createdBy: opts.actorId ?? 'system',
    });
    return { url, status: res.status, title, description, text, publishedAt, fromCache: false, source, blockedByRobots: false, error: '' };
  } catch (e) {
    return { url, status: 0, title: '', description: '', text: '', publishedAt: '', fromCache: false, source: null, blockedByRobots: false, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

/* -------------------------------- SearXNG -------------------------------- */

export interface SearxngConfig { baseUrl: string }

export function searxngConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SearxngConfig | null {
  const base = (env.SEARXNG_BASE_URL ?? '').trim();
  return base ? { baseUrl: base.replace(/\/$/, '') } : null;
}

/** Self-hosted SearXNG metasearch — the preferred search layer. */
export async function searxngSearch(cfg: SearxngConfig, query: string, opts: { maxResults?: number; timeoutMs?: number } = {}): Promise<WebSearchResult[]> {
  const url = `${cfg.baseUrl}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 12000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`searxng ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string; publishedDate?: string | null; engine?: string }> };
  return (body.results ?? [])
    .filter((r) => r.url)
    .slice(0, opts.maxResults ?? 8)
    .map((r) => ({
      title: r.title?.trim() || (r.url as string),
      url: r.url as string,
      publisher: hostnameOf(r.url as string),
      publishedAt: r.publishedDate ?? '',
      snippet: (r.content ?? '').slice(0, 600),
    }));
}

/* -------------------------------- RSS/Atom ------------------------------- */

export interface FeedItem { title: string; url: string; publishedAt: string; summary: string }

function textBetween(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return (m?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

/** Tolerant RSS 2.0 / Atom parsing without dependencies. */
export function parseFeed(xml: string, maxItems = 20): FeedItem[] {
  const items: FeedItem[] = [];
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const chunk of rssItems.slice(0, maxItems)) {
    const link = textBetween(chunk, 'link') || /<link[^>]*href=["']([^"']+)["']/i.exec(chunk)?.[1] || '';
    items.push({ title: textBetween(chunk, 'title'), url: link, publishedAt: textBetween(chunk, 'pubDate') || textBetween(chunk, 'dc:date'), summary: textBetween(chunk, 'description').slice(0, 500) });
  }
  if (!items.length) {
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
    for (const chunk of entries.slice(0, maxItems)) {
      const link = /<link[^>]*href=["']([^"']+)["']/i.exec(chunk)?.[1] ?? textBetween(chunk, 'id');
      items.push({ title: textBetween(chunk, 'title'), url: link, publishedAt: textBetween(chunk, 'updated') || textBetween(chunk, 'published'), summary: (textBetween(chunk, 'summary') || textBetween(chunk, 'content')).slice(0, 500) });
    }
  }
  return items.filter((i) => i.url);
}

export async function fetchFeed(url: string, opts: { maxItems?: number; timeoutMs?: number; runId?: string | null; actorId?: string } = {}): Promise<FeedItem[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 12000), headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const items = parseFeed(await res.text(), opts.maxItems ?? 20);
  for (const item of items.slice(0, 10)) {
    await saveResearchSource({
      url: item.url, canonicalUrl: item.url, title: item.title, publisher: hostnameOf(item.url), publishedAt: item.publishedAt,
      retrievalMethod: 'rss', extractedText: '', snippet: item.summary, language: /[؀-ۿ]/.test(item.title) ? 'fa' : 'en',
      query: '', runId: opts.runId ?? null, createdBy: opts.actorId ?? 'system',
    });
  }
  return items;
}

/* -------------------------------- sitemap -------------------------------- */

export async function discoverSitemapUrls(siteBase: string, opts: { limit?: number; timeoutMs?: number } = {}): Promise<string[]> {
  try {
    const base = siteBase.replace(/\/$/, '');
    const res = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).filter((x): x is string => Boolean(x));
    return locs.slice(0, opts.limit ?? 50);
  } catch {
    return [];
  }
}

/* ------------------------------ status truth ----------------------------- */

export interface ResearchCoverageStatus {
  searxng: boolean;
  tavilyOptional: boolean;
  directFetch: true; // always available when the process has network egress
  coverage: 'metasearch' | 'direct_only';
  detail: string;
}

/** Honest coverage report for the UI (mandate: reduced coverage is shown,
 *  never silently substituted with a paid API). */
export function researchCoverageStatus(env: NodeJS.ProcessEnv = process.env): ResearchCoverageStatus {
  const sx = Boolean(searxngConfigFromEnv(env));
  const tav = Boolean((env.TAVILY_API_KEY ?? '').trim());
  return {
    searxng: sx,
    tavilyOptional: tav,
    directFetch: true,
    coverage: sx || tav ? 'metasearch' : 'direct_only',
    detail: sx
      ? 'SearXNG metasearch active (self-hosted).'
      : tav
        ? 'SearXNG not configured; optional Tavily adapter active. Deploy SearXNG for fully self-hosted search (see deployment/searxng.md).'
        : 'No metasearch configured — research runs in direct-source mode (URLs, RSS, sitemaps, GitHub). Deploy SearXNG to restore broad web search (see deployment/searxng.md).',
  };
}
