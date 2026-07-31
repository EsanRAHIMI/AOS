/**
 * D-208 — the happening feed is a projection, and these are the promises it
 * makes to the stage that animates it.
 *
 * The owner's directive was specific: every happening gets a card, and a card
 * that belongs under an earlier card must move under its parent. That turns
 * three otherwise-invisible properties into contract surface:
 *
 *   1. PARENTAGE IS DERIVED, NOT DECLARED. A tool call knows its `runId`; the
 *      run knows its `turnId`. If that hop breaks, every child silently
 *      becomes a root and the stage stops nesting — with no error anywhere.
 *   2. NOTHING IS INVENTED. Every card must trace back to a governed row.
 *   3. THE CURSOR CANNOT SKIP. A turn and its first tool call share a
 *      millisecond routinely; an exclusive cursor would drop one of them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb, collection } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { COLLECTIONS } from '../src/constants/index.js';
import {
  listHappenings, groupHappenings, categoryForTool, labelForTool,
} from '../src/happenings/index.js';

const ACTOR = { actorId: 'user_owner', tenantId: null };
const T0 = '2026-07-31T09:00:00.000Z';

beforeEach(() => { setTestDb(createFakeDb().db); });

/** One turn, its run, and the tool calls that run made. */
async function seedTurnWithTools(opts: {
  turnId: string; runId: string; at?: string;
  tools: Array<{ id: string; name: string; status?: string; policy?: string; summary?: string }>;
}): Promise<void> {
  const at = opts.at ?? T0;
  await collection(COLLECTIONS.JARVIS_SESSION_TURNS).insertOne({
    turnId: opts.turnId, sessionId: 'sess_1', index: 0,
    userText: 'فردا ساعت ۱۰ جلسه بگذار', replyText: 'گذاشتم.',
    status: 'completed', runId: opts.runId, reasoningMode: 'native',
    createdAt: at, finishedAt: at,
  } as never);
  await collection(COLLECTIONS.AGENT_LOOP_RUNS).insertOne({
    runId: opts.runId, turnId: opts.turnId, sessionId: 'sess_1', createdAt: at,
  } as never);
  for (const t of opts.tools) {
    await collection(COLLECTIONS.TOOL_INVOCATIONS).insertOne({
      invocationId: t.id, runId: opts.runId, toolName: t.name,
      status: t.status ?? 'executed', policyDecision: t.policy ?? 'auto_allowed',
      resultSummary: t.summary ?? '', actorId: ACTOR.actorId, createdAt: at,
    } as never);
  }
}

describe('parentage — the nesting the stage animates', () => {
  it('docks a tool call under the turn that asked for it', async () => {
    await seedTurnWithTools({
      turnId: 'turn_1', runId: 'run_1',
      tools: [{ id: 'inv_1', name: 'calendar_create_event', summary: 'DONE id=abc' }],
    });

    const feed = await listHappenings(ACTOR);
    const tool = feed.find((h) => h.happeningId === 'hp_tool_inv_1');
    expect(tool?.parentId).toBe('hp_said_turn_1');
  });

  it('leaves an unprompted tool call as a ROOT — that is the card to notice', async () => {
    // No run row: this invocation belongs to no conversation. The system acted
    // on its own, and burying that under someone else's card would hide it.
    await collection(COLLECTIONS.TOOL_INVOCATIONS).insertOne({
      invocationId: 'inv_solo', runId: 'run_ghost', toolName: 'mission_update',
      status: 'executed', policyDecision: 'auto_allowed', resultSummary: 'progress 40%',
      actorId: ACTOR.actorId, createdAt: T0,
    } as never);

    const feed = await listHappenings(ACTOR);
    const solo = feed.find((h) => h.happeningId === 'hp_tool_inv_solo');
    expect(solo?.parentId).toBeNull();
    expect(solo?.actor).toBe('system');
  });

  it('groups children oldest-first under their root, and promotes orphans', async () => {
    await seedTurnWithTools({
      turnId: 'turn_2', runId: 'run_2',
      tools: [
        { id: 'inv_a', name: 'calendar_agenda' },
        { id: 'inv_b', name: 'calendar_create_event' },
      ],
    });
    const feed = await listHappenings(ACTOR);
    const groups = groupHappenings(feed);

    const turnGroup = groups.find((g) => g.root.happeningId === 'hp_said_turn_2');
    expect(turnGroup).toBeDefined();
    // reply + both tool calls all dock under what the owner said
    expect(turnGroup!.children.map((c) => c.happeningId).sort())
      .toEqual(['hp_reply_turn_2', 'hp_tool_inv_a', 'hp_tool_inv_b']);

    // An orphan (parent outside the page) becomes a root rather than vanishing.
    const orphan = groupHappenings([
      { ...feed[0], happeningId: 'hp_x', parentId: 'hp_said_gone' },
    ] as never);
    expect(orphan).toHaveLength(1);
    expect(orphan[0].root.happeningId).toBe('hp_x');
  });
});

describe('honesty — a card exists only where a governed row does', () => {
  it('an empty ledger yields an empty feed, never a placeholder card', async () => {
    expect(await listHappenings(ACTOR)).toEqual([]);
  });

  it('carries the real record ids so every card can be audited', async () => {
    await seedTurnWithTools({
      turnId: 'turn_3', runId: 'run_3',
      tools: [{ id: 'inv_c', name: 'memory_record', summary: 'stored' }],
    });
    const tool = (await listHappenings(ACTOR)).find((h) => h.happeningId === 'hp_tool_inv_c');
    expect(tool?.refIds).toEqual(['inv_c', 'run_3']);
  });

  it('marks a denied call as denied — governance working is not a failure', async () => {
    await seedTurnWithTools({
      turnId: 'turn_4', runId: 'run_4',
      tools: [{ id: 'inv_d', name: 'calendar_delete_event', policy: 'denied_safe_mode', status: 'denied' }],
    });
    const h = (await listHappenings(ACTOR)).find((x) => x.happeningId === 'hp_tool_inv_d');
    expect(h?.status).toBe('denied');
    expect(h?.kind).toBe('tool_blocked');
  });

  it('flags a degraded reply on the card, so composed is never read as reasoned', async () => {
    await collection(COLLECTIONS.JARVIS_SESSION_TURNS).insertOne({
      turnId: 'turn_5', sessionId: 'sess_1', index: 0,
      userText: 'سلام', replyText: 'سلام.', status: 'completed',
      runId: null, reasoningMode: 'none', createdAt: T0, finishedAt: T0,
    } as never);
    const reply = (await listHappenings(ACTOR)).find((h) => h.happeningId === 'hp_reply_turn_5');
    expect(reply?.detail).toContain('حالت محدود');
  });
});

describe('priority — a pending approval outranks everything', () => {
  it('gives a pending approval the maximum weight and waiting status', async () => {
    await collection(COLLECTIONS.AGENT_LOOP_RUNS).insertOne({
      runId: 'run_6', turnId: 'turn_6', sessionId: 'sess_1', createdAt: T0,
    } as never);
    await collection(COLLECTIONS.AGENT_APPROVAL_CHECKPOINTS).insertOne({
      approvalId: 'appr_1', runId: 'run_6', toolName: 'calendar_delete_event',
      summary: 'حذف رویداد جلسهٔ تیم', status: 'pending', createdAt: T0,
    } as never);

    const h = (await listHappenings(ACTOR)).find((x) => x.happeningId === 'hp_appr_appr_1');
    expect(h?.status).toBe('waiting');
    expect(h?.weight).toBe(1);
    // The stage reads this: weight 1 + waiting ⇒ the card never auto-departs.
    expect(h?.parentId).toBe('hp_said_turn_6');
  });

  it('ranks a read below a write, so the stage does not equalise their dwell', async () => {
    await seedTurnWithTools({
      turnId: 'turn_7', runId: 'run_7',
      tools: [
        { id: 'inv_read', name: 'memory_search' },
        { id: 'inv_fail', name: 'calendar_update_event', status: 'failed' },
      ],
    });
    const feed = await listHappenings(ACTOR);
    const read = feed.find((h) => h.happeningId === 'hp_tool_inv_read')!;
    const failed = feed.find((h) => h.happeningId === 'hp_tool_inv_fail')!;
    expect(failed.weight).toBeGreaterThan(read.weight);
  });
});

describe('the incremental cursor cannot skip a card', () => {
  it('is inclusive, so two rows in the same millisecond both survive', async () => {
    // The exact collision the exclusive cursor lost: a turn and its first tool
    // call written at the same instant.
    await seedTurnWithTools({
      turnId: 'turn_8', runId: 'run_8', at: T0,
      tools: [{ id: 'inv_same_ms', name: 'calendar_agenda' }],
    });

    const first = await listHappenings(ACTOR, { limit: 1 });
    expect(first).toHaveLength(1);

    // Poll with the newest timestamp as the cursor — the sibling written in
    // the same millisecond must still be delivered.
    const next = await listHappenings(ACTOR, { afterIso: first[0].at });
    expect(next.map((h) => h.happeningId)).toContain('hp_tool_inv_same_ms');
  });

  it('sorts newest-first, parent ahead of its children, and stably', async () => {
    await seedTurnWithTools({
      turnId: 'turn_9', runId: 'run_9', at: '2026-07-31T08:00:00.000Z',
      tools: [{ id: 'inv_old', name: 'memory_search' }],
    });
    await seedTurnWithTools({
      turnId: 'turn_10', runId: 'run_10', at: '2026-07-31T12:00:00.000Z',
      tools: [{ id: 'inv_new', name: 'memory_search' }],
    });
    const a = (await listHappenings(ACTOR)).map((h) => h.happeningId);
    const b = (await listHappenings(ACTOR)).map((h) => h.happeningId);

    // The newest turn is first, and its children follow it — never precede it,
    // or the client would briefly render a child as a root and then reparent.
    expect(a[0]).toBe('hp_said_turn_10');
    expect(a.indexOf('hp_said_turn_10')).toBeLessThan(a.indexOf('hp_tool_inv_new'));
    expect(a.indexOf('hp_said_turn_10')).toBeLessThan(a.indexOf('hp_reply_turn_10'));
    // And the older turn's whole group sits below the newer one.
    expect(a.indexOf('hp_tool_inv_new')).toBeLessThan(a.indexOf('hp_said_turn_9'));

    expect(a).toEqual(b); // stable across reads, or the client cursor drifts
  });
});

describe('categorisation — the owner\'s words, not the kernel\'s modules', () => {
  it('maps tool families by prefix, so a new tool needs no table entry', () => {
    expect(categoryForTool('calendar_create_event')).toBe('calendar');
    expect(categoryForTool('mission_update')).toBe('tasks');
    expect(categoryForTool('memory_record')).toBe('memory');
    expect(categoryForTool('research_web_search')).toBe('knowledge');
    expect(categoryForTool('cin_claim_issue')).toBe('trust');
    // A tool nobody mapped is still shown — as system, never dropped.
    expect(categoryForTool('brand_new_tool')).toBe('system');
  });

  it('falls back to the raw tool name rather than inventing a label', () => {
    expect(labelForTool('calendar_create_event')).toBe('ساخت رویداد');
    expect(labelForTool('brand_new_tool')).toBe('brand_new_tool');
  });

  it('filters by category without changing order', async () => {
    await seedTurnWithTools({
      turnId: 'turn_11', runId: 'run_11',
      tools: [
        { id: 'inv_cal', name: 'calendar_agenda' },
        { id: 'inv_mem', name: 'memory_search' },
      ],
    });
    const cal = await listHappenings(ACTOR, { categories: ['calendar'] });
    expect(cal.map((h) => h.happeningId)).toEqual(['hp_tool_inv_cal']);
  });
});

describe('scoping — the feed never widens past its actor', () => {
  it('excludes another actor\'s proactive events', async () => {
    await collection(COLLECTIONS.PROACTIVE_EVENTS).insertOne({
      eventId: 'ev_mine', kind: 'mission_overdue', priority: 'attention',
      title: 'ماموریت عقب افتاده', detail: '', refIds: ['m1'],
      dedupKey: 'a', status: 'new', actorId: ACTOR.actorId, tenantId: null,
      createdAt: T0, updatedAt: T0,
    } as never);
    await collection(COLLECTIONS.PROACTIVE_EVENTS).insertOne({
      eventId: 'ev_theirs', kind: 'mission_overdue', priority: 'attention',
      title: 'someone else', detail: '', refIds: [],
      dedupKey: 'b', status: 'new', actorId: 'user_other', tenantId: null,
      createdAt: T0, updatedAt: T0,
    } as never);

    const ids = (await listHappenings(ACTOR)).map((h) => h.happeningId);
    expect(ids).toContain('hp_pro_ev_mine');
    expect(ids).not.toContain('hp_pro_ev_theirs');
  });
});
