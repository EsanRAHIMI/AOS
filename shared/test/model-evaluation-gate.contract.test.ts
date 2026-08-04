import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResult, ToolCallingProvider } from '../src/llm/toolcalling.js';
import { ModelEvaluationSuiteSchema, runModelEvaluationSuite } from '../src/evaluation/model-gate.js';

class FixtureProvider implements ToolCallingProvider {
  readonly name = 'fixture';
  constructor(private readonly failCritical = false) {}
  async chat(request: ChatRequest): Promise<ChatResult> {
    const prompt = request.messages[0]?.content ?? '';
    if (prompt === 'tool') {
      return {
        text: '', toolCalls: [{ callId: 'c1', toolName: this.failCritical ? 'wrong_tool' : 'memory_search', args: { query: 'gpu', extra: true } }],
        tokensIn: 10, tokensOut: 4, costUsd: 0, model: request.model, provider: this.name,
      };
    }
    return {
      text: '{"summary":"ok","risks":[]}', toolCalls: [], tokensIn: 8, tokensOut: 6,
      costUsd: 0, model: request.model, provider: this.name,
    };
  }
}

const suite = ModelEvaluationSuiteSchema.parse({
  suiteId: 'contract', version: '1.0.0',
  thresholds: { overallScore: 1, maxP95LatencyMs: 1000, requireAllCritical: true },
  cases: [
    {
      caseId: 'tool', title: 'tool', category: 'tool_arguments', critical: true,
      system: 'test', prompt: 'tool', maxLatencyMs: 1000,
      tools: [{ name: 'memory_search', description: 'search', inputSchema: { type: 'object' } }],
      expect: { toolName: 'memory_search', toolArgs: { query: 'gpu' } },
    },
    {
      caseId: 'json', title: 'json', category: 'structured_output',
      system: 'test', prompt: 'json', maxLatencyMs: 1000,
      expect: { noToolCall: true, jsonRequired: true, jsonRequiredKeys: ['summary', 'risks'] },
    },
  ],
});

describe('model evaluation release gate', () => {
  it('passes deterministic tool, subset-argument and JSON checks', async () => {
    const report = await runModelEvaluationSuite(suite, {
      provider: new FixtureProvider(),
      models: { reasoning: 'fixture', standard: 'fixture', fast: 'fixture' },
    });
    expect(report).toMatchObject({ passed: true, score: 1, totalCases: 2, passedCases: 2, criticalFailures: [] });
    expect(report.totals).toMatchObject({ tokensIn: 18, tokensOut: 10, costUsd: 0 });
  });

  it('fails the gate when a critical case regresses', async () => {
    const report = await runModelEvaluationSuite(suite, {
      provider: new FixtureProvider(true),
      models: { reasoning: 'fixture', standard: 'fixture', fast: 'fixture' },
    });
    expect(report.passed).toBe(false);
    expect(report.criticalFailures).toEqual(['tool']);
    expect(report.gateReasons.join(' ')).toContain('critical failures');
  });

  it('rejects duplicate case identifiers', () => {
    const duplicated = { ...suite, cases: [...suite.cases, suite.cases[0]] };
    expect(ModelEvaluationSuiteSchema.safeParse(duplicated).success).toBe(false);
  });

  it('normalizes Persian characters and zero-width spaces without weakening alternatives', async () => {
    const persianSuite = ModelEvaluationSuiteSchema.parse({
      suiteId: 'fa', version: '1',
      thresholds: { overallScore: 1, maxP95LatencyMs: 1000, requireAllCritical: true },
      cases: [{
        caseId: 'fa-copy', title: 'fa copy', category: 'safety', system: 'test', prompt: 'json',
        maxLatencyMs: 1000,
        expect: { textContainsAny: [['تأیید', 'تایید'], ['ریسک', 'خطر']] },
      }],
    });
    const provider: ToolCallingProvider = {
      name: 'fa-fixture',
      chat: async (request) => ({
        text: 'تایید این کار ریسک دارد.', toolCalls: [], tokensIn: 1, tokensOut: 1,
        costUsd: 0, model: request.model, provider: 'fa-fixture',
      }),
    };
    const report = await runModelEvaluationSuite(persianSuite, {
      provider, models: { reasoning: 'fixture', standard: 'fixture', fast: 'fixture' },
    });
    expect(report.passed).toBe(true);
  });
});
