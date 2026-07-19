#!/usr/bin/env node
/**
 * CIN-1 (D-179) — genesis seed: the network's first three living entities.
 *
 *   1. person  "Ehsan Rahimi"  — founder & final human authority
 *   2. ai_agent "Jarvis"       — the owner's personal OS agent
 *   3. service "AOS Kernel"    — the system's own identity in its own graph
 *
 * Plus the genesis relations and the first verifiable claims (founder role,
 * agent representation), all anchored in the hash-chained ledger. Idempotent:
 * skips creation if a genesis entity of the same name+type already exists.
 *
 * Usage: MONGODB_URI=... [MONGODB_DB_NAME=...] node scripts/cin-genesis-seed.mjs
 */
import {
  connectMongo, closeMongo,
  createEntity, listEntities, createRelation, issueClaim, verifyClaim, verifyChain,
} from '@factory/shared';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('FAIL: MONGODB_URI required'); process.exit(1); }
const DB = process.env.MONGODB_DB_NAME ?? 'autonomous_os_kernel';

const actor = { actorId: 'owner', scope: 'user', tenantId: null };

async function ensureEntity(input) {
  const existing = (await listEntities({ entityType: input.entityType })).find((e) => e.name === input.name);
  if (existing) { console.log(`SKIP  ${input.entityType} "${input.name}" already exists (${existing.entityId})`); return existing; }
  const { entity } = await createEntity(actor, input);
  console.log(`SEED  ${input.entityType} "${input.name}" → ${entity.entityId}`);
  return entity;
}

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: DB });

  const owner = await ensureEntity({
    entityType: 'person', name: 'Ehsan Rahimi', displayName: 'Ehsan Rahimi',
    tags: ['founder', 'owner'],
    sections: {
      identity: { data: { fullName: 'Ehsan Rahimi', role: 'Founder & System Architect' }, visibility: 'network' },
      governance: { data: { authority: 'final_human_authority', approvals: 'required_for_sensitive_actions' }, visibility: 'network' },
    },
  });

  const jarvis = await ensureEntity({
    entityType: 'ai_agent', name: 'Jarvis', displayName: 'Jarvis — Personal OS',
    tags: ['personal-os', 'kernel-agent'],
    sections: {
      capabilities: { data: { families: ['memory', 'missions', 'research', 'session', 'personal', 'cin'] }, visibility: 'network' },
      governance: { data: { finalAuthority: owner.entityId, approvalGated: true }, visibility: 'network' },
    },
  });

  const kernel = await ensureEntity({
    entityType: 'service', name: 'AOS Kernel', displayName: 'Autonomous OS Kernel',
    tags: ['kernel', 'cin-core'],
    sections: {
      operations: { data: { repo: 'autonomous-os-kernel', gateway: 'gateway-api:4101' }, visibility: 'network' },
    },
  });

  // Genesis relations (duplicate guard makes these idempotent-safe to attempt).
  const tryRel = async (input, label) => {
    try { await createRelation(actor, input); console.log(`SEED  relation ${label}`); }
    catch (e) { console.log(`SKIP  relation ${label}: ${e.message}`); }
  };
  await tryRel({ fromEntityId: owner.entityId, toEntityId: kernel.entityId, relationType: 'owns', role: 'founder' }, 'owner owns kernel');
  await tryRel({ fromEntityId: jarvis.entityId, toEntityId: owner.entityId, relationType: 'represents', role: 'personal_os' }, 'jarvis represents owner');
  await tryRel({ fromEntityId: kernel.entityId, toEntityId: jarvis.entityId, relationType: 'operates', role: 'runtime_host' }, 'kernel operates jarvis');

  // Genesis claims: the kernel attests the founder; the owner attests Jarvis.
  const founderClaim = await issueClaim({
    issuerEntityId: kernel.entityId, subjectEntityId: owner.entityId,
    claimType: 'kernel.genesis.founder', payload: { role: 'founder', since: '2026-06-25' },
  });
  const agentClaim = await issueClaim({
    issuerEntityId: owner.entityId, subjectEntityId: jarvis.entityId,
    claimType: 'agent.authorized_representative', payload: { scope: 'personal_os', approvalGated: true },
  });
  const v1 = await verifyClaim(founderClaim.claimId);
  const v2 = await verifyClaim(agentClaim.claimId);
  const chain = await verifyChain();
  console.log(`CLAIM founder verified=${v1.valid}; agent verified=${v2.valid}`);
  console.log(`CHAIN ok=${chain.ok} length=${chain.length} head=${chain.headHash?.slice(0, 12)}…`);
  if (!v1.valid || !v2.valid || !chain.ok) { console.error('FAIL: genesis verification failed'); process.exit(1); }
  console.log('CIN GENESIS COMPLETE');
  await closeMongo();
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
