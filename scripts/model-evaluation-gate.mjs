#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ModelEvaluationSuiteSchema,
  modelRegistryFromEnv,
  runModelEvaluationSuite,
  toolCallingProviderFor,
} from '@factory/shared';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const suitePath = resolve(argument('--suite', 'evaluations/model-gate.v1.json'));
const outputPath = resolve(argument('--output', 'artifacts/model-evaluation-report.json'));
const baselinePath = argument('--baseline');
const maxRegression = Number(argument('--max-score-regression', '0.02'));
const validateOnly = process.argv.includes('--validate-only');

let suite;
try {
  suite = ModelEvaluationSuiteSchema.parse(JSON.parse(await readFile(suitePath, 'utf8')));
} catch (error) {
  console.error('INVALID SUITE:', error instanceof Error ? error.message : error);
  process.exit(2);
}

if (validateOnly) {
  console.log(`VALID ${suite.suiteId}@${suite.version} cases=${suite.cases.length}`);
  process.exit(0);
}

const registry = modelRegistryFromEnv(process.env);
const provider = toolCallingProviderFor(registry);
if (!provider) {
  console.error('BLOCKED: no model provider configured. Set LLM_LOCAL_BASE_URL and LLM_LOCAL_MODEL (recommended), or a cloud provider key.');
  process.exit(2);
}

console.log(`AOS model evaluation: ${suite.suiteId}@${suite.version}`);
console.log(`provider=${provider.name} local=${registry.isLocal} models=${JSON.stringify(registry.models)}`);
const report = await runModelEvaluationSuite(suite, { provider, models: registry.models });

if (baselinePath) {
  try {
    const baseline = JSON.parse(await readFile(resolve(baselinePath), 'utf8'));
    const regression = Number(baseline.score ?? 0) - report.score;
    if (regression > maxRegression) {
      report.passed = false;
      report.gateReasons.push(`score regression ${regression.toFixed(4)} exceeds ${maxRegression}`);
    }
  } catch (error) {
    console.error('INVALID BASELINE:', error instanceof Error ? error.message : error);
    process.exit(2);
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const item of report.cases) {
  console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.caseId} score=${item.score.toFixed(2)} latency=${item.latencyMs}ms${item.error ? ` error=${item.error}` : ''}`);
}
console.log(`\nscore=${report.score.toFixed(4)} passed=${report.passed} cases=${report.passedCases}/${report.totalCases} p95=${report.p95LatencyMs}ms`);
console.log(`report=${outputPath}`);
if (report.gateReasons.length) console.log(`gate=${report.gateReasons.join('; ')}`);
process.exit(report.passed ? 0 : 1);
