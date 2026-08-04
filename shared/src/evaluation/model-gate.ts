import { z } from 'zod';
import type { LoopMessage } from '../agentcore/schemas.js';
import type { ChatResult, ModelTier, ToolCallingProvider } from '../llm/toolcalling.js';
import { nowIso } from '../utils/index.js';

const JsonObject = z.record(z.string(), z.unknown());

export const ModelEvaluationExpectationSchema = z.object({
  toolName: z.string().min(1).optional(),
  toolArgs: JsonObject.optional(),
  noToolCall: z.boolean().default(false),
  textContainsAll: z.array(z.string().min(1)).default([]),
  textContainsAny: z.array(z.array(z.string().min(1)).min(1)).default([]),
  textExcludesAll: z.array(z.string().min(1)).default([]),
  jsonRequired: z.boolean().default(false),
  jsonRequiredKeys: z.array(z.string().min(1)).default([]),
}).superRefine((value, ctx) => {
  if (value.toolName && value.noToolCall) ctx.addIssue({ code: 'custom', message: 'toolName and noToolCall are mutually exclusive' });
  if (value.toolArgs && !value.toolName) ctx.addIssue({ code: 'custom', message: 'toolArgs requires toolName' });
});

export const ModelEvaluationCaseSchema = z.object({
  caseId: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(['tool_selection', 'tool_arguments', 'structured_output', 'grounded_response', 'safety']),
  locale: z.enum(['fa', 'en', 'mixed']).default('en'),
  critical: z.boolean().default(false),
  weight: z.number().positive().default(1),
  minScore: z.number().min(0).max(1).default(1),
  modelTier: z.enum(['reasoning', 'standard', 'fast']).default('standard'),
  system: z.string().min(1),
  prompt: z.string().min(1),
  maxTokens: z.number().int().positive().max(32768).default(512),
  maxLatencyMs: z.number().int().positive().default(15000),
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: JsonObject,
  })).default([]),
  expect: ModelEvaluationExpectationSchema,
});

export const ModelEvaluationSuiteSchema = z.object({
  suiteId: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  thresholds: z.object({
    overallScore: z.number().min(0).max(1).default(0.85),
    maxP95LatencyMs: z.number().int().positive().default(15000),
    requireAllCritical: z.boolean().default(true),
  }),
  cases: z.array(ModelEvaluationCaseSchema).min(1),
}).superRefine((suite, ctx) => {
  const ids = new Set<string>();
  for (const item of suite.cases) {
    if (ids.has(item.caseId)) ctx.addIssue({ code: 'custom', message: `duplicate caseId: ${item.caseId}` });
    ids.add(item.caseId);
  }
});

export type ModelEvaluationSuite = z.infer<typeof ModelEvaluationSuiteSchema>;
export type ModelEvaluationCase = z.infer<typeof ModelEvaluationCaseSchema>;

export interface ModelEvaluationCaseResult {
  caseId: string;
  category: ModelEvaluationCase['category'];
  critical: boolean;
  passed: boolean;
  score: number;
  latencyMs: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  error: string | null;
}

export interface ModelEvaluationReport {
  suiteId: string;
  suiteVersion: string;
  provider: string;
  models: Record<ModelTier, string>;
  startedAt: string;
  finishedAt: string;
  score: number;
  passed: boolean;
  totalCases: number;
  passedCases: number;
  criticalFailures: string[];
  p95LatencyMs: number;
  totals: { tokensIn: number; tokensOut: number; costUsd: number };
  gateReasons: string[];
  cases: ModelEvaluationCaseResult[];
}

export interface RunModelEvaluationOptions {
  provider: ToolCallingProvider;
  models: Record<ModelTier, string>;
  timeoutPaddingMs?: number;
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200C\u200D]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function isSubset(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length <= actual.length && expected.every((item, index) => isSubset(item, actual[index]));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
      Object.hasOwn(actual as object, key) && isSubset(value, (actual as Record<string, unknown>)[key]));
  }
  return Object.is(expected, actual);
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const objectStart = candidate.indexOf('{');
  const arrayStart = candidate.indexOf('[');
  const start = [objectStart, arrayStart].filter((n) => n >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) return null;
  const end = candidate[start] === '{' ? candidate.lastIndexOf('}') : candidate.lastIndexOf(']');
  if (end < start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

function scoreResult(item: ModelEvaluationCase, response: ChatResult, latencyMs: number): ModelEvaluationCaseResult {
  const checks: ModelEvaluationCaseResult['checks'] = [];
  const expected = item.expect;
  if (expected.toolName) {
    const call = response.toolCalls.find((candidate) => candidate.toolName === expected.toolName);
    checks.push({ name: 'tool_selection', passed: Boolean(call), detail: call ? `selected ${call.toolName}` : `expected ${expected.toolName}` });
    if (expected.toolArgs) {
      const valid = Boolean(call) && isSubset(expected.toolArgs, call?.args);
      checks.push({ name: 'tool_arguments', passed: valid, detail: valid ? 'expected argument subset matched' : 'tool arguments did not match' });
    }
  }
  if (expected.noToolCall) {
    checks.push({ name: 'no_tool_call', passed: response.toolCalls.length === 0, detail: `${response.toolCalls.length} tool call(s)` });
  }
  const normalizedText = normalize(response.text);
  for (const term of expected.textContainsAll) {
    const passed = normalizedText.includes(normalize(term));
    checks.push({ name: `contains:${term}`, passed, detail: passed ? 'required term present' : 'required term missing' });
  }
  for (const alternatives of expected.textContainsAny) {
    const matched = alternatives.find((term) => normalizedText.includes(normalize(term)));
    checks.push({
      name: `contains_any:${alternatives.join('|')}`,
      passed: Boolean(matched),
      detail: matched ? `matched: ${matched}` : 'none of the accepted terms were present',
    });
  }
  for (const term of expected.textExcludesAll) {
    const passed = !normalizedText.includes(normalize(term));
    checks.push({ name: `excludes:${term}`, passed, detail: passed ? 'forbidden term absent' : 'forbidden term present' });
  }
  if (expected.jsonRequired || expected.jsonRequiredKeys.length > 0) {
    const parsed = extractJson(response.text);
    checks.push({ name: 'valid_json', passed: parsed !== null, detail: parsed === null ? 'no valid JSON object/array' : 'valid JSON parsed' });
    if (expected.jsonRequiredKeys.length > 0) {
      const record = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      const missing = expected.jsonRequiredKeys.filter((key) => !Object.hasOwn(record, key));
      checks.push({ name: 'json_required_keys', passed: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'all required keys present' });
    }
  }
  checks.push({ name: 'latency', passed: latencyMs <= item.maxLatencyMs, detail: `${latencyMs}ms <= ${item.maxLatencyMs}ms` });
  const score = checks.length ? checks.filter((check) => check.passed).length / checks.length : 0;
  return {
    caseId: item.caseId, category: item.category, critical: item.critical,
    passed: score >= item.minScore, score: Number(score.toFixed(4)), latencyMs,
    model: response.model, tokensIn: response.tokensIn, tokensOut: response.tokensOut,
    costUsd: response.costUsd, checks, error: null,
  };
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export async function runModelEvaluationSuite(
  rawSuite: ModelEvaluationSuite,
  options: RunModelEvaluationOptions,
): Promise<ModelEvaluationReport> {
  const suite = ModelEvaluationSuiteSchema.parse(rawSuite);
  const startedAt = nowIso();
  const results: ModelEvaluationCaseResult[] = [];
  for (const item of suite.cases) {
    const started = performance.now();
    try {
      const messages: LoopMessage[] = [{ role: 'user', content: item.prompt, toolCalls: [], toolCallId: '', toolName: '' }];
      const response = await options.provider.chat({
        system: item.system, messages, tools: item.tools, model: options.models[item.modelTier],
        maxTokens: item.maxTokens,
        signal: AbortSignal.timeout(item.maxLatencyMs + (options.timeoutPaddingMs ?? 1000)),
      });
      results.push(scoreResult(item, response, Math.round(performance.now() - started)));
    } catch (error) {
      results.push({
        caseId: item.caseId, category: item.category, critical: item.critical, passed: false, score: 0,
        latencyMs: Math.round(performance.now() - started), model: options.models[item.modelTier],
        tokensIn: 0, tokensOut: 0, costUsd: 0, checks: [],
        error: error instanceof Error ? error.message : 'model evaluation failed',
      });
    }
  }

  const totalWeight = suite.cases.reduce((sum, item) => sum + item.weight, 0);
  const weighted = results.reduce((sum, result, index) => sum + result.score * suite.cases[index]!.weight, 0);
  const score = Number((weighted / totalWeight).toFixed(4));
  const criticalFailures = results.filter((result) => result.critical && !result.passed).map((result) => result.caseId);
  const p95LatencyMs = percentile95(results.map((result) => result.latencyMs));
  const gateReasons: string[] = [];
  if (score < suite.thresholds.overallScore) gateReasons.push(`score ${score} is below ${suite.thresholds.overallScore}`);
  if (suite.thresholds.requireAllCritical && criticalFailures.length) gateReasons.push(`critical failures: ${criticalFailures.join(', ')}`);
  if (p95LatencyMs > suite.thresholds.maxP95LatencyMs) gateReasons.push(`p95 latency ${p95LatencyMs}ms exceeds ${suite.thresholds.maxP95LatencyMs}ms`);
  return {
    suiteId: suite.suiteId, suiteVersion: suite.version, provider: options.provider.name, models: options.models,
    startedAt, finishedAt: nowIso(), score, passed: gateReasons.length === 0,
    totalCases: results.length, passedCases: results.filter((result) => result.passed).length,
    criticalFailures, p95LatencyMs,
    totals: {
      tokensIn: results.reduce((sum, result) => sum + result.tokensIn, 0),
      tokensOut: results.reduce((sum, result) => sum + result.tokensOut, 0),
      costUsd: Number(results.reduce((sum, result) => sum + result.costUsd, 0).toFixed(6)),
    },
    gateReasons, cases: results,
  };
}
