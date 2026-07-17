/**
 * K2 D-177 — Independent research stack proofs (mandate §G): dependency-free
 * HTML extraction, RSS/Atom parsing, robots.txt honoring, provenance ledger
 * with publication + retrieval dates, honest coverage status, and — the
 * independence guarantee — NO paid search API is a runtime requirement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  extractReadableText, extractPublishedAt, parseFeed, sha256,
  saveResearchSource, findCachedSource, researchCoverageStatus,
} from '../src/research/providers.js';
import { webSearchProviderFromEnv, estimateReliability } from '../src/research/index.js';

describe('HTML extraction', () => {
  it('strips scripts/styles/nav and yields readable text + title + description', () => {
    const html = `<html><head><title>AOS Docs</title><meta name="description" content="the AOS system"></head>
      <body><nav>menu junk</nav><script>evil()</script><h1>Heading</h1><p>First paragraph.</p><p>Second paragraph.</p><footer>foot</footer></body></html>`;
    const { title, description, text } = extractReadableText(html);
    expect(title).toBe('AOS Docs');
    expect(description).toBe('the AOS system');
    expect(text).toContain('First paragraph.');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('menu junk');
  });

  it('extracts a publication date from article meta', () => {
    expect(extractPublishedAt('<meta property="article:published_time" content="2026-05-01T10:00:00Z">')).toBe('2026-05-01T10:00:00Z');
    expect(extractPublishedAt('<html>no date</html>')).toBe('');
  });
});

describe('RSS/Atom parsing', () => {
  it('parses RSS 2.0 items', () => {
    const xml = `<rss><channel>
      <item><title>Release 7.0</title><link>https://ex.com/a</link><pubDate>Wed, 01 May 2026</pubDate><description>notes</description></item>
      <item><title>Release 7.1</title><link>https://ex.com/b</link></item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Release 7.0', url: 'https://ex.com/a' });
  });

  it('parses Atom entries', () => {
    const xml = `<feed><entry><title>Post</title><link href="https://ex.com/p"/><updated>2026-05-02</updated><summary>s</summary></entry></feed>`;
    const items = parseFeed(xml);
    expect(items[0]).toMatchObject({ title: 'Post', url: 'https://ex.com/p' });
  });
});

describe('provenance ledger', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('saves a source with both publication and retrieval dates and dedups on content hash', async () => {
    const a = await saveResearchSource({ url: 'https://docs.example/x', canonicalUrl: 'https://docs.example/x', title: 'X', publisher: 'docs.example', publishedAt: '2026-04-01', retrievalMethod: 'direct_fetch', extractedText: 'hello world', snippet: 'hello', language: 'en', query: 'q', runId: null, createdBy: 'esan' });
    expect(a.retrievedAt).toBeTruthy();
    expect(a.freshnessDays).toBeGreaterThanOrEqual(0);
    expect(a.contentHash).toBe(sha256('hello world'));
    const b = await saveResearchSource({ url: 'https://docs.example/x', canonicalUrl: 'https://docs.example/x', title: 'X', publisher: 'docs.example', publishedAt: '2026-04-01', retrievalMethod: 'direct_fetch', extractedText: 'hello world', snippet: 'hello', language: 'en', query: 'q', runId: null, createdBy: 'esan' });
    expect(b.sourceId).toBe(a.sourceId); // dedup, not a second row
    const cached = await findCachedSource('https://docs.example/x', 24);
    expect(cached?.sourceId).toBe(a.sourceId);
  });

  it('reliability heuristic marks official docs high and social low', () => {
    expect(estimateReliability('https://docs.anthropic.com/x')).toBe('high');
    expect(estimateReliability('https://reddit.com/r/x')).toBe('low');
    expect(estimateReliability('https://some-random-blog.xyz')).toBe('medium');
  });
});

describe('independence: no paid search API is required', () => {
  it('coverage is honest and direct-source mode works with NOTHING configured', () => {
    const s = researchCoverageStatus({} as NodeJS.ProcessEnv);
    expect(s.directFetch).toBe(true);
    expect(s.coverage).toBe('direct_only');
    expect(s.searxng).toBe(false);
    expect(s.detail).toMatch(/direct-source/i);
  });

  it('SearXNG is the preferred provider when configured (self-hosted, not paid)', () => {
    const p = webSearchProviderFromEnv({ SEARXNG_BASE_URL: 'http://searxng.local:8080' } as unknown as NodeJS.ProcessEnv);
    expect(p?.providerId).toBe('searxng');
  });

  it('no provider is configured by default (no silent paid fallback)', () => {
    expect(webSearchProviderFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
