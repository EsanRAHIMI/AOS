/**
 * Browser Testing Agent — entry point (Phase 4).
 *
 * Runs a permission-governed UI test: open a URL and assert title/status/text/
 * selector, optionally capturing a screenshot to S3. Uses Playwright when a
 * browser is available, otherwise an HTTP fallback that still produces a real,
 * evidence-backed result. Only internal/owned targets are allowed by default.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  ROOT_DOMAIN,
  FileStorage,
  isAllowedBrowserTarget,
  buildEvidence,
  startAgentRun,
  finishAgentRun,
  genId,
  nowIso,
  BrowserTestPlanSchema,
  type BrowserTestReport,
  type BrowserCheckResult,
  type EvidenceRecord,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

/** Build an S3 client only if fully configured; screenshots are optional. */
function maybeStorage(): FileStorage | null {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET } = process.env;
  if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && AWS_REGION && AWS_S3_BUCKET) {
    return new FileStorage({ region: AWS_REGION, bucket: AWS_S3_BUCKET, accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY });
  }
  return null;
}

const titleOf = (html: string): string => (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();

function evalChecks(checks: { type: string; value: string }[], ctx: { title: string; status: number | null; html: string; selectorPresent: (s: string) => boolean }): BrowserCheckResult[] {
  return checks.map((c) => {
    let passed = false;
    let actual = '';
    switch (c.type) {
      case 'title_equals': actual = ctx.title; passed = ctx.title === c.value; break;
      case 'title_contains': actual = ctx.title; passed = ctx.title.includes(c.value); break;
      case 'status_is': actual = String(ctx.status ?? ''); passed = String(ctx.status) === c.value; break;
      case 'text_present': actual = c.value; passed = ctx.html.includes(c.value); break;
      case 'selector_present': actual = c.value; passed = ctx.selectorPresent(c.value); break;
    }
    return { ...c, passed, actual } as BrowserCheckResult;
  });
}

/** Try Playwright; resolve null if no browser is available. */
async function runPlaywright(url: string, checks: { type: string; value: string }[], screenshot: boolean): Promise<{ report: Omit<BrowserTestReport, 'reportId' | 'createdAt' | 'screenshotS3ObjectId'>; shot: Buffer | null } | null> {
  const spec = 'playwright-core';
  // Variable specifier dodges static module resolution; module is optional.
  const pw = (await import(spec).catch(() => null)) as { chromium?: { launch: (o?: unknown) => Promise<unknown> } } | null;
  if (!pw?.chromium) return null;
  type PwBrowser = { newPage: () => Promise<unknown>; close: () => Promise<void> };
  let browser: PwBrowser | null = null;
  try {
    browser = (await pw.chromium.launch()) as PwBrowser;
    const page = (await browser.newPage()) as {
      goto: (u: string) => Promise<{ status: () => number } | null>;
      title: () => Promise<string>;
      content: () => Promise<string>;
      locator: (s: string) => { count: () => Promise<number> };
      screenshot: () => Promise<Buffer>;
    };
    const resp = await page.goto(url);
    const status = resp?.status() ?? null;
    const title = await page.title();
    const html = await page.content();
    const results = evalChecks(checks, { title, status, html, selectorPresent: () => true });
    // Re-evaluate selector checks with the real DOM.
    for (const r of results) {
      if (r.type === 'selector_present') r.passed = (await page.locator(r.value).count()) > 0;
    }
    const shot = screenshot ? await page.screenshot() : null;
    const passed = results.every((r) => r.passed);
    return { report: { url, mode: 'playwright', httpStatus: status, title, passed, checks: results, notes: 'real browser' }, shot };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function runHttp(url: string, checks: { type: string; value: string }[]): Promise<Omit<BrowserTestReport, 'reportId' | 'createdAt' | 'screenshotS3ObjectId'>> {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const title = titleOf(html);
    // Heuristic selector check from raw HTML (no DOM in fallback).
    const selectorPresent = (s: string): boolean => html.includes(s) || html.includes(s.replace(/^[.#]/, ''));
    const results = evalChecks(checks, { title, status: res.status, html, selectorPresent });
    const passed = results.every((r) => r.passed);
    return { url, mode: 'http_fallback', httpStatus: res.status, title, passed, checks: results, notes: 'HTTP fallback (no browser); selector checks are heuristic' };
  } catch (e) {
    return { url, mode: 'http_fallback', httpStatus: null, title: '', passed: false, checks: [], notes: `fetch failed: ${String(e)}` };
  }
}

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  const parsed = BrowserTestPlanSchema.safeParse(req.input ?? {});
  if (!parsed.success) {
    await finishAgentRun(runId, { status: 'failed', error: 'invalid test plan' });
    return { taskId, accepted: false, agentRunId: runId, error: 'invalid test plan' };
  }
  const plan = parsed.data;
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: `Browser test: ${plan.url}` } });

  const reportId = genId('btr');
  let body: Omit<BrowserTestReport, 'reportId' | 'createdAt' | 'screenshotS3ObjectId'>;
  let shot: Buffer | null = null;

  // Permission gate: internal/owned targets only.
  if (!isAllowedBrowserTarget(plan.url, ROOT_DOMAIN)) {
    body = { url: plan.url, mode: 'blocked', httpStatus: null, title: '', passed: false, checks: [], notes: 'Target not on the internal/owned allowlist; approval required.' };
  } else {
    const pw = await runPlaywright(plan.url, plan.checks, plan.screenshot).catch(() => null);
    if (pw) { body = pw.report; shot = pw.shot; }
    else body = await runHttp(plan.url, plan.checks);
  }

  // Optional screenshot → S3.
  let screenshotS3ObjectId: string | null = null;
  if (shot) {
    const storage = maybeStorage();
    if (storage) {
      const key = `factory/artifacts/browser-tests/${reportId}.png`;
      await storage.put(key, shot, 'image/png');
      screenshotS3ObjectId = key;
    }
  }

  const report: BrowserTestReport = { reportId, screenshotS3ObjectId, createdAt: nowIso(), ...body };

  // Evidence: test report (+ screenshot if any).
  const evidence: EvidenceRecord[] = [
    buildEvidence({ type: 'test_report', summary: `Browser test ${report.passed ? 'passed' : 'failed'} (${report.mode}) for ${plan.url}`, taskId, serviceName: 'browser-testing-agent', data: { report } }),
  ];
  if (screenshotS3ObjectId) {
    evidence.push(buildEvidence({ type: 'screenshot', summary: `Screenshot of ${plan.url}`, taskId, serviceName: 'browser-testing-agent', s3ObjectId: screenshotS3ObjectId }));
  }
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).insertMany(evidence);
  for (const e of evidence) await ctx.publisher.publish({ type: EVENT_TYPES.EVIDENCE_RECORDED, taskId, payload: { evidenceId: e.evidenceId, evidenceType: e.type, message: e.summary } });
  await ctx.publisher.publish({ type: EVENT_TYPES.BROWSER_TEST_COMPLETED, taskId, payload: { reportId, mode: report.mode, passed: report.passed, message: `Browser test ${report.passed ? 'passed' : 'failed'} (${report.mode})` } });

  await finishAgentRun(runId, { status: 'succeeded', summary: `Browser test ${report.mode} passed=${report.passed}` });
  return { taskId, accepted: true, agentRunId: runId, report, evidenceIds: evidence.map((e) => e.evidenceId) };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS).createIndex({ evidenceId: 1 }, { unique: true });
  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    taskHandler: handleTask,
  });
  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
