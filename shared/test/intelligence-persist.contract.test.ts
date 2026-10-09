/**
 * In-process intelligence persistence. These functions are what orchestrator
 * and gateway call after the HTTP specialist services were folded in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { COLLECTIONS, EVENT_TYPES } from '../src/constants/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { executeQa, executeReport, executeResearch, executeReview, recordTaskDocumentation } from '../src/intelligence/persist.js';

const published: Array<{ type: string; taskId: string | null }> = [];
const publish = async (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => {
  published.push({ type: e.type, taskId: e.taskId });
  return true;
};

let fake: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  fake = createFakeDb();
  setTestDb(fake.db);
  published.length = 0;
});

describe('in-process intelligence persistence', () => {
  it('persists a research run, evidence, and completion event without HTTP', async () => {
    const out = await executeResearch({ topic: 'retention policy', taskId: 'task-1', forceFallback: true, searchProvider: null, publish });
    expect(out.research.reportId).toBeTruthy();
    expect(out.research.evidenceId).toBeTruthy();
    expect(fake.dump(COLLECTIONS.RESEARCH_REPORTS)).toHaveLength(1);
    expect(fake.dump(COLLECTIONS.EVIDENCE_RECORDS)[0]?.evidenceId).toBe(out.research.evidenceId);
    expect(fake.dump(COLLECTIONS.LLM_TRACES)).toHaveLength(1);
    expect(fake.dump(COLLECTIONS.LLM_COST_RECORDS)).toHaveLength(1);
    expect(published.map((e) => e.type)).toEqual([EVENT_TYPES.AGENT_RUN_STARTED, EVENT_TYPES.RESEARCH_COMPLETED_V2]);
  });

  it('persists a failed review with its evidence record', async () => {
    const out = await executeReview({ target: 'plan', content: 'short', taskId: 'task-1', forceFallback: true, publish });
    expect(out.review.passed).toBe(false);
    expect(fake.dump(COLLECTIONS.REVIEW_REPORTS)[0]?.reviewId).toBe(out.review.reviewId);
    expect(fake.dump(COLLECTIONS.EVIDENCE_RECORDS)).toHaveLength(1);
    expect(published.some((e) => e.type === EVENT_TYPES.REVIEW_COMPLETED)).toBe(true);
  });

  it('persists QA and an executive report from the same evidence chain', async () => {
    const qa = await executeQa({ goal: 'ship retention', evidenceSummary: 'research:none', taskId: 'task-1', forceFallback: true, publish });
    const report = await executeReport({
      title: 'Executive report: ship retention',
      goal: 'ship retention',
      kind: 'executive',
      taskId: 'task-1',
      evidenceIds: [qa.qa.evidenceId],
      forceFallback: true,
      publish,
    });
    expect(fake.dump(COLLECTIONS.QA_REPORTS)[0]?.qaId).toBe(qa.qa.qaId);
    expect(fake.dump(COLLECTIONS.INTELLIGENCE_REPORTS)[0]?.reportId).toBe(report.report.reportId);
    expect(published.map((e) => e.type)).toContain(EVENT_TYPES.QA_COMPLETED);
    expect(published.map((e) => e.type)).toContain(EVENT_TYPES.REPORT_GENERATED);
  });

  it('writes the three task documents and doc.updated events', async () => {
    const out = await recordTaskDocumentation({
      taskId: 'task-9',
      goal: 'document the change',
      summary: 'Task task-9: document the change',
      infrastructureRequestId: 'infra-1',
      publish,
    });
    expect(out.updated).toEqual(['phase-log', 'decision-log', 'task-task-9']);
    expect(fake.dump(COLLECTIONS.DOCUMENTS).map((d) => d.slug).sort()).toEqual(['decision-log', 'phase-log', 'task-task-9']);
    expect(published.filter((e) => e.type === EVENT_TYPES.DOC_UPDATED)).toHaveLength(3);
    const decision = fake.dump(COLLECTIONS.DOCUMENTS).find((d) => d.slug === 'decision-log');
    expect(String(decision?.body)).toContain('infra-1');
  });
});
