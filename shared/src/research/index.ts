/**
 * Phase AG — Real Research & Intelligence Fabric.
 *
 * `internet-research-service` previously had no real web-search API: its
 * "real" mode meant only that the LLM router itself was real — the actual
 * source URLs still came from the model's own recall (or, worse, a curated
 * fallback), which is exactly the "no fake success" line this codebase
 * otherwise holds. This module adds a genuine `WebSearchProvider`
 * abstraction — one interface, swappable providers, direct `fetch()` calls
 * (no SDK), mirroring the existing `LlmProvider` pattern in `../llm` — so
 * `runResearch()` (see `../intelligence/index.ts`) can ground its findings
 * in results a real search engine actually returned, not text an LLM
 * generated from training data.
 *
 * When no API key is configured, `webSearchProviderFromEnv()` returns
 * `null` and the caller falls back to the pre-existing LLM-recall/curated
 * behavior, honestly marked — never a fabricated "search succeeded".
 */

export interface WebSearchResult {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  snippet: string;
}

export interface WebSearchProvider {
  readonly providerId: 'tavily';
  search(query: string, opts?: { maxResults?: number }): Promise<WebSearchResult[]>;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Tavily — chosen as the first real provider because it's built specifically
 * for LLM/RAG grounding (concise content snippets, not raw HTML to parse),
 * has a simple single-endpoint REST API with no OAuth flow, and matches the
 * "direct fetch, no heavy SDK" style already used for GitHub/Dokploy/LLM
 * providers in this codebase. The interface is provider-agnostic — a second
 * provider (Serper, Bing) can be added later behind the same
 * `WebSearchProvider` contract without touching `runResearch()`.
 */
export class TavilyProvider implements WebSearchProvider {
  readonly providerId = 'tavily' as const;
  constructor(private readonly apiKey: string) {}

  async search(query: string, opts?: { maxResults?: number }): Promise<WebSearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: opts?.maxResults ?? 6,
        include_answer: false,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) throw new Error(`tavily search failed: ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
    };
    return (body.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: r.title?.trim() || r.url!,
        url: r.url!,
        publisher: hostnameOf(r.url!),
        publishedAt: r.published_date ?? '',
        snippet: (r.content ?? '').slice(0, 600),
      }));
  }
}

/** `null` (not a Mock provider) when unconfigured — there is no honest
 *  deterministic stand-in for "the internet said X", unlike LLM's MockProvider
 *  which can validly return an empty completion for its caller to handle. */
export function webSearchProviderFromEnv(env: NodeJS.ProcessEnv = process.env): WebSearchProvider | null {
  const key = (env.TAVILY_API_KEY ?? '').trim();
  return key ? new TavilyProvider(key) : null;
}

export interface WebSearchStatus { configured: boolean; provider: 'tavily' | 'none' }

export function webSearchStatusFromEnv(env: NodeJS.ProcessEnv = process.env): WebSearchStatus {
  const p = webSearchProviderFromEnv(env);
  return p ? { configured: true, provider: p.providerId } : { configured: false, provider: 'none' };
}

/**
 * Heuristic source-reliability estimate from the domain alone — used only
 * when a real search result has no other reliability signal. Deliberately
 * conservative: unknown domains default to 'medium', never 'high'. This is
 * a heuristic, not a fact-checking system, and is documented as such
 * wherever it's surfaced.
 */
const HIGH_RELIABILITY_HOSTS = [
  /(^|\.)gov$/, /\.gov\.[a-z]{2}$/, /(^|\.)edu$/, /\.edu\.[a-z]{2}$/,
  /^owasp\.org$/, /^nist\.gov$/, /^ietf\.org$/, /^w3\.org$/, /^iso\.org$/,
  /^docs\.anthropic\.com$/, /^platform\.openai\.com$/, /^developer\.mozilla\.org$/,
  /(^|\.)wikipedia\.org$/,
];
const LOW_RELIABILITY_HOSTS = [
  /(^|\.)blogspot\.com$/, /(^|\.)medium\.com$/, /(^|\.)reddit\.com$/,
  /(^|\.)quora\.com$/, /(^|\.)pinterest\.com$/,
];

export function estimateReliability(url: string): 'high' | 'medium' | 'low' {
  const host = hostnameOf(url);
  if (!host) return 'low';
  if (HIGH_RELIABILITY_HOSTS.some((p) => p.test(host))) return 'high';
  if (LOW_RELIABILITY_HOSTS.some((p) => p.test(host))) return 'low';
  return 'medium';
}

/* ===================== Phase AG.1 — dispatch outcome classification ==================== *
 * gateway-api calls internet-research-service's /.factory/task over real HTTP
 * (network I/O stays in gateway-api, matching this codebase's layering). The
 * two functions below turn that raw fetch()/response into a caller-facing
 * outcome — pure, no I/O, so they're unit-testable without a running server.
 * They also give three genuinely different situations three genuinely
 * different labels, instead of collapsing "the service process isn't
 * running" and "the service ran but Tavily isn't configured" into the same
 * generic error, which is what produced the earlier confusing behavior:
 *   - the fetch() itself throws (DNS/connection refused/timeout)  -> service_unreachable
 *   - the fetch() succeeds but HTTP status is not ok               -> service_error
 *   - the fetch() succeeds, 200, but no research payload            -> empty_result
 *   - the fetch() succeeds, 200, research present, sourceMode isn't
 *     'search_api' (Tavily not configured or search failed there)  -> provider_not_configured (ok: true — this is an honest, successful, non-error outcome)
 *   - the fetch() succeeds, 200, sourceMode is 'search_api'         -> errorKind: null (ok: true)
 */

export type ResearchDispatchErrorKind = 'service_unreachable' | 'service_error' | 'route_not_found' | 'empty_result' | 'provider_not_configured' | null;

export interface ResearchDispatchOutcome {
  ok: boolean;
  errorKind: ResearchDispatchErrorKind;
  summary: string;
  data?: unknown;
}

export interface ResearchTaskPayload {
  reportId: string;
  mode: string;
  sourceMode: string;
  /** Phase AG.3 — whether the summary/findings/recommendations were actually
   *  reasoned over by an LLM ('llm_synthesized') or are the deterministic
   *  retrieval-only restatement ('deterministic_fallback'). Independent of
   *  sourceMode: real Tavily sources can coexist with fallback synthesis. */
  synthesisMode?: string;
  synthesisFailureReason?: string | null;
  summary: string;
  findings: string[];
  recommendations: string[];
  sources: Array<{ title: string; url: string; reliability: string; sourceMode: string }>;
}

/** A `fetch()` call to internet-research-service threw before any HTTP
 *  response was received — the process is unreachable, not merely erroring.
 *  Distinguishes that from other thrown errors (e.g. a bad URL) by matching
 *  the well-known Node/undici connection-failure signatures. */
export function classifyResearchFetchFailure(url: string, errorMessage: string): ResearchDispatchOutcome {
  const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|the operation was aborted/i.test(errorMessage);
  return {
    ok: false,
    errorKind: unreachable ? 'service_unreachable' : 'service_error',
    summary: unreachable
      ? `internet-research-service is unreachable at ${url} — it is not running or not accepting connections. Start it locally with "pnpm --filter @factory/internet-research-service run dev" (after "pnpm sync:env" so it has a .env), or confirm the Dokploy app is up in production. (${errorMessage})`
      : `Could not reach internet-research-service at ${url}: ${errorMessage}`,
  };
}

/** internet-research-service responded — interpret its `/.factory/task`
 *  result into a caller-facing outcome. `sourceMode !== 'search_api'` is
 *  reported as `provider_not_configured` but with `ok: true`: the service
 *  did real, honest work (LLM recall or curated fallback) and said so — it
 *  is not a failure, just not a live search result.
 *
 *  Phase AG.4 — `meta` carries diagnostic context (the exact URL/method
 *  dispatched, and a raw-body snippet when the response wasn't parseable
 *  JSON) so a route/host mismatch — e.g. a misresolved peer URL landing on
 *  an unrelated host that answers 404 with an HTML page — is diagnosable
 *  from the summary text alone, instead of collapsing into "unknown error".
 *  A 404/405 specifically is classified as `route_not_found`, distinct from
 *  other HTTP error statuses: it means the request reached SOME server, but
 *  not one that recognizes this route — a contract/routing bug, not a
 *  generic service failure. */
export function interpretResearchTaskResponse(
  status: number,
  httpOk: boolean,
  body: { data?: { research?: ResearchTaskPayload }; error?: { message?: string } },
  meta: { url?: string; method?: string; rawBodySnippet?: string } = {},
): ResearchDispatchOutcome {
  const where = meta.url ? ` (${meta.method ?? 'POST'} ${meta.url})` : '';
  if (!httpOk) {
    const errorKind: ResearchDispatchErrorKind = status === 404 || status === 405 ? 'route_not_found' : 'service_error';
    const detail = body.error?.message
      ?? (meta.rawBodySnippet ? `non-JSON/unrecognized response body: ${JSON.stringify(meta.rawBodySnippet.slice(0, 200))}` : 'unknown error');
    const hint = errorKind === 'route_not_found'
      ? ' This means the request reached a server, but not one exposing this route — check that gateway-api is resolving internet-research-service to the correct local URL (not a stale/production registry domain) and that the service actually registers POST /.factory/task.'
      : '';
    return { ok: false, errorKind, summary: `internet-research-service returned ${status}${where}: ${detail}.${hint}` };
  }
  const research = body.data?.research;
  if (!research) {
    return { ok: false, errorKind: 'empty_result', summary: 'internet-research-service returned no research result.' };
  }
  const modeLabel = research.sourceMode === 'search_api'
    ? 'live web search (Tavily)'
    : research.sourceMode === 'curated_fallback'
      ? 'curated fallback — search not configured'
      : 'LLM recall — search not configured, treat sources as unverified';
  // Phase AG.3 — surface synthesis state explicitly and separately from
  // sourceMode, so real search results + failed LLM synthesis is never
  // reported to the caller (or Jarvis) as complete, synthesized research.
  const synthesisLabel = research.synthesisMode === 'llm_synthesized'
    ? 'LLM-synthesized'
    : `deterministic fallback${research.synthesisFailureReason ? ` — ${research.synthesisFailureReason}` : ''}`;
  const topSources = research.sources.slice(0, 4).map((s) => `${s.title} — ${s.url}`).join(' | ');
  const summary = `${research.summary} [sourceMode: ${research.sourceMode} — ${modeLabel}] [synthesisMode: ${research.synthesisMode ?? 'deterministic_fallback'} — ${synthesisLabel}]${research.findings.length ? ` Findings: ${research.findings.slice(0, 3).join(' | ')}.` : ''}${topSources ? ` Sources: ${topSources}.` : ' No sources returned.'}`;
  return {
    ok: true,
    errorKind: research.sourceMode === 'search_api' ? null : 'provider_not_configured',
    summary,
    data: {
      reportId: research.reportId, mode: research.mode, sourceMode: research.sourceMode,
      synthesisMode: research.synthesisMode ?? 'deterministic_fallback', synthesisFailureReason: research.synthesisFailureReason ?? null,
      sources: research.sources, recommendations: research.recommendations,
    },
  };
}
