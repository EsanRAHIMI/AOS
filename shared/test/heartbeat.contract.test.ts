/**
 * CIN-2 (D-180) — Jarvis Heartbeat proofs: the deterministic pulse that acts
 * between conversations. Grounded events only (missionIds/firingIds/chain
 * report), dedup-by-construction across pulses, ack lifecycle, and the
 * trust-chain integrity check surfacing as a critical proactive event.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { COLLECTIONS } from '../src/constants/index.js';
import { createMissionNode, type MissionActor } from '../src/missions/index.js';
import { createWatch, fireWatch, type WatchActor } from '../src/watches/index.js';
import { appendLedger } from '../src/cin/index.js';
import {
  runHeartbeatOnce, listProactiveEvents, setProactiveEventStatus, lastHeartbeat,
  type HeartbeatActor,
} from '../src/heartbeat/index.js';

const actor: HeartbeatActor = { actorId: 'esan', scope: 'user', tenantId: null };
const missionActor: MissionActor = { actorId: 'esan', scope: 'user', tenantId: null };
const watchActor: WatchActor = { actorId: 'esan', scope: 'user', tenantId: null };

let fake: ReturnType<typeof createFakeDb>;
beforeEach(() => { fake = createFakeDb(); setTestDb(fake.db); });

async function seedOverdueMission() {
  const vision = await createMissionNode(missionActor, { nodeType: 'vision', title: 'CIN v2 live' });
  const obj = await createMissionNode(missionActor, { nodeType: 'strategic_objective', title: 'Ship CIN-2', parentId: vision.node.nodeId });
  const prog = await createMissionNode(missionActor, { nodeType: 'program', title: 'Realtime core', parentId: obj.node.nodeId });
  const mission = await createMissionNode(missionActor, {
    nodeType: 'mission', title: 'Owner stream live', parentId: prog.node.nodeId,
    priority: 'critical', dueAt: '2020-01-01T00:00:00.000Z',
  });
  return mission.node;
}

describe('heartbeat pulse', () => {
  it('turns real mission health into grounded proactive events', async () => {
    const overdue = await seedOverdueMission();
    const { run, created } = await runHeartbeatOnce(actor);
    expect(run.checks).toEqual(['missions', 'watches', 'trust_chain']);
    const kinds = created.map((e) => e.kind);
    expect(kinds).toContain('mission_overdue');
    const ev = created.find((e) => e.kind === 'mission_overdue')!;
    expect(ev.refIds).toContain(overdue.nodeId); // grounded, not prose
    expect(ev.priority).toBe('critical');        // critical mission → critical event
    expect(await lastHeartbeat(actor)).not.toBeNull();
  });

  it('never duplicates open events across pulses (dedup by construction)', async () => {
    await seedOverdueMission();
    const first = await runHeartbeatOnce(actor);
    expect(first.created.length).toBeGreaterThan(0);
    const second = await runHeartbeatOnce(actor);
    expect(second.created).toHaveLength(0);
    expect(second.run.deduped).toBeGreaterThan(0);
  });

  it('re-surfaces after dismissal only via a fresh pulse finding, and ack works', async () => {
    await seedOverdueMission();
    const { created } = await runHeartbeatOnce(actor);
    const ev = created[0]!;
    expect(await setProactiveEventStatus(actor, ev.eventId, 'acked')).toBe(true);
    const open = await listProactiveEvents(actor);
    expect(open.find((e) => e.eventId === ev.eventId)).toBeUndefined();
    // Once acked/dismissed the same finding MAY be recreated by a later pulse
    // (the condition still holds) — that is correct behavior, not spam.
    const again = await runHeartbeatOnce(actor);
    expect(again.created.map((e) => e.dedupKey)).toContain(ev.dedupKey);
  });

  it('surfaces actionable watch firings', async () => {
    const watch = await createWatch(watchActor, { kind: 'overdue_commitments', title: 'Visa deadline' });
    await fireWatch(watchActor, watch, { headline: 'Visa deadline in 3 days', dedupKey: 'visa-3d', actionable: true });
    const { created } = await runHeartbeatOnce(actor);
    const alert = created.find((e) => e.kind === 'watch_alert');
    expect(alert?.title).toBe('Visa deadline in 3 days');
  });

  it('flags a broken trust chain as a critical event', async () => {
    await appendLedger({ recordType: 'entity.created', refId: 'z1', summary: 'genesis-ish' });
    await appendLedger({ recordType: 'claim.issued', refId: 'z2', summary: 'ok' });
    await fake.db.collection(COLLECTIONS.CIN_LEDGER).updateOne({ seq: 0 }, { $set: { summary: 'FORGED' } });
    const { created } = await runHeartbeatOnce(actor);
    const alert = created.find((e) => e.kind === 'trust_chain_broken');
    expect(alert).toBeDefined();
    expect(alert!.priority).toBe('critical');
  });

  it('streams via cursor: listProactiveEvents(afterIso) returns only newer events', async () => {
    await seedOverdueMission();
    const { created } = await runHeartbeatOnce(actor);
    const cursor = created[created.length - 1]!.createdAt;
    const newer = await listProactiveEvents(actor, { afterIso: cursor });
    expect(newer.every((e) => e.createdAt > cursor)).toBe(true);
  });
});
