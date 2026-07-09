/**
 * K1.1 contract tests — LLM router safety invariants (shared/src/llm).
 * The load-bearing rule of the whole intelligence layer: NOTHING unvalidated
 * ever escapes `generateStructured`. These tests pin that invariant plus the
 * honest-tracing and governance-default contracts. No network is touched:
 * unkeyed routers use the Mock provider; keyed paths use forceFallback.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  LlmRouter, llmRouterFromEnv, llmStatusFromEnv, llmGovernanceFromEnv,
  buildLlmCostRecord, MockProvider,
} from '../src/llm/index.js';

const Shape = z.object({ answer: z.string(), score: z.number().min(0).max(1) });

describe('provider selection', () => {
  it('no keys → mock provider (deterministic mode)', () => {
    expect(new LlmRouter({}).activeProvider).toBe('mock');
  });
  it('anthropic preferred by default when keyed', () => {
    expect(new LlmRouter({ anthropicApiKey: 'k', openaiApiKey: 'k2' }).activeProvider).toBe('anthropic');
  });
  it('explicit openai default is honored', () => {
    expect(new LlmRouter({ openaiApiKey: 'k2', defaultProvider: 'openai' }).activeProvider).toBe('openai');
  });
  it('llmRouterFromEnv reads a supplied env, not ambient state', () => {
    expect(llmRouterFromEnv({} as NodeJS.ProcessEnv).activeProvider).toBe('mock');
    expect(llmRouterFromEnv({ OPENAI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).activeProvider).toBe('openai');
  });
});

describe('generateStructured — the validation invariant', () => {
  it('unkeyed: returns the schema-validated fallback and says so honestly', async () => {
    const router = new LlmRouter({});
    const { data, trace } = await router.generateStructured(Shape, {
      agentId: 'test-agent', taskType: 'unit_test', prompt: 'irrelevant',
      fallback: () => ({ answer: 'deterministic', score: 0.5 }),
    });
    expect(data).toEqual({ answer: 'deterministic', score: 0.5 });
    expect(trace.usedFallback).toBe(true);
    expect(trace.provider).toBe('mock');
    expect(trace.costUsd).toBe(0);
    expect(trace.traceId).toMatch(/^llm_/);
  });

  it('an INVALID fallback throws — nothing unvalidated can escape', async () => {
    const router = new LlmRouter({});
    await expect(router.generateStructured(Shape, {
      agentId: 'test-agent', taskType: 'unit_test', prompt: 'irrelevant',
      // score violates the schema — the router must refuse to return it.
      fallback: () => ({ answer: 'bad', score: 7 }),
    })).rejects.toThrow();
  });

  it('forceFallback skips the provider entirely even when keyed (safe mode / budget stop)', async () => {
    const router = new LlmRouter({ anthropicApiKey: 'not-a-real-key' });
    const { data, trace } = await router.generateStructured(Shape, {
      agentId: 'test-agent', taskType: 'unit_test', prompt: 'irrelevant',
      fallback: () => ({ answer: 'forced', score: 1 }),
      forceFallback: true,
    });
    expect(data.answer).toBe('forced');
    expect(trace.usedFallback).toBe(true);
    expect(trace.attempts).toBe(0); // no provider call was attempted
    expect(trace.tokensIn).toBe(0);
  });
});

describe('mock provider honesty', () => {
  it('returns empty text at zero cost (forcing the fallback path)', async () => {
    const res = await new MockProvider().complete({ system: 's', prompt: 'p', model: 'mock' });
    expect(res.text).toBe('');
    expect(res.costUsd).toBe(0);
  });
});

describe('status + governance from env', () => {
  it('reports fallback mode when unkeyed and real when keyed', () => {
    expect(llmStatusFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({ configured: false, mode: 'fallback', provider: 'mock' });
    expect(llmStatusFromEnv({ ANTHROPIC_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toMatchObject({ configured: true, mode: 'real', provider: 'anthropic' });
  });
  it('governance defaults are conservative and overridable', () => {
    const d = llmGovernanceFromEnv({} as NodeJS.ProcessEnv);
    expect(d).toMatchObject({ maxCostPerTaskUsd: 0.5, dailyCostLimitUsd: 20, safeModeFallback: true });
    expect(d.allowedProviders).toEqual(['anthropic', 'openai']);
    const o = llmGovernanceFromEnv({ LLM_SAFE_MODE_FALLBACK: 'false', LLM_DAILY_COST_LIMIT_USD: '5' } as unknown as NodeJS.ProcessEnv);
    expect(o.safeModeFallback).toBe(false);
    expect(o.dailyCostLimitUsd).toBe(5);
  });
});

describe('cost records', () => {
  it('maps a trace 1:1 into a cost record', async () => {
    const router = new LlmRouter({});
    const { trace } = await router.generateStructured(Shape, {
      agentId: 'agent-x', taskType: 'unit_test', taskId: 'task_1', prompt: 'p',
      fallback: () => ({ answer: 'a', score: 0 }),
    });
    const rec = buildLlmCostRecord(trace);
    expect(rec.recordId).toMatch(/^cost_/);
    expect(rec).toMatchObject({
      taskId: 'task_1', agentId: 'agent-x', taskType: 'unit_test',
      provider: trace.provider, model: trace.model,
      tokensIn: trace.tokensIn, tokensOut: trace.tokensOut,
      costUsd: trace.costUsd, usedFallback: true, traceId: trace.traceId,
    });
  });
});
