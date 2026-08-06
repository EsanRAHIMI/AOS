/**
 * Prompt caching contract (D-212).
 *
 * Both providers cache on a literal prefix. That makes packet ORDER a cost and
 * latency decision, not just a prompting one — and a wrong order fails
 * silently: every answer is still correct, the bill is just several times
 * larger and the first token several hundred milliseconds later. Nothing in
 * the type system or the existing suites can catch that, so it is asserted
 * here directly.
 */
import { describe, it, expect } from 'vitest';
import { composeTurnContext, type TurnContextParts } from '../src/jarvis/turn-runner.js';
import { anthropicSystemBlocks } from '../src/llm/toolcalling.js';

const base: TurnContextParts = {
  identity: 'OWNER: Masi — founder.',
  memory: 'OWNER MEMORY: prefers Persian, works late.',
  missions: 'ACTIVE MISSIONS: ship the kernel.',
  status: 'SYSTEM STATUS: research coverage=partial.',
  transcript: 'RECENT CONVERSATION:\nyou: hi\njarvis: hello',
  now: 'NOW: 2026-08-06T09:00:00Z (Asia/Tehran)',
};

/** Length of the shared leading run of two strings, in characters. */
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

describe('composeTurnContext — stable prefix', () => {
  it('puts the clock last, so two turns a second apart share every earlier byte', () => {
    const first = composeTurnContext(base);
    const second = composeTurnContext({ ...base, now: 'NOW: 2026-08-06T09:00:01Z (Asia/Tehran)' });

    /* Everything except the clock is identical, so the shared prefix must run
     * AT LEAST to where the clock begins. Not exactly: two timestamps a second
     * apart agree on their own leading characters too ("NOW: 2026-08-06T09:00:0"),
     * so divergence lands a little way inside the clock. Asserting equality
     * here would be asserting the shape of a timestamp, which is not the
     * property under test. */
    const divergesAt = commonPrefixLength(first, second);
    expect(divergesAt).toBeGreaterThanOrEqual(first.indexOf(base.now));
    // Sanity: that is nearly the whole packet, not a token or two.
    expect(divergesAt).toBeGreaterThan(first.length * 0.8);
  });

  it('appending to the transcript does not disturb the standing facts above it', () => {
    const first = composeTurnContext(base);
    const grown = composeTurnContext({ ...base, transcript: `${base.transcript}\nyou: and again` });
    expect(commonPrefixLength(first, grown)).toBeGreaterThanOrEqual(first.indexOf(base.transcript));
  });

  it('is order-sensitive by construction — the clock never precedes identity', () => {
    const text = composeTurnContext(base);
    expect(text.indexOf(base.now)).toBeGreaterThan(text.indexOf(base.identity));
    expect(text.indexOf(base.now)).toBeGreaterThan(text.indexOf(base.transcript));
  });

  it('drops empty sections without leaving blank gaps that shift the prefix', () => {
    const text = composeTurnContext({ ...base, transcript: '' });
    expect(text).not.toContain('\n\n\n');
    expect(text.startsWith(base.identity)).toBe(true);
  });
});

describe('anthropicSystemBlocks', () => {
  it('marks a single cache breakpoint, which covers the tool schemas above it', () => {
    const blocks = anthropicSystemBlocks('you are jarvis');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'text',
      text: 'you are jarvis',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('carries the prompt through unchanged — caching must not rewrite the role', () => {
    const prompt = 'line one\n\nline two — با متن فارسی';
    expect((anthropicSystemBlocks(prompt)[0] as { text: string }).text).toBe(prompt);
  });
});
