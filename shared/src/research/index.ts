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
