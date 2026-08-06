#!/usr/bin/env node
/**
 * Check whether `MEMORY_RETRIEVAL_MODE=atlas_hybrid` will actually do anything (D-215).
 *
 * WHY A SCRIPT AND NOT A STARTUP CHECK
 * ------------------------------------
 * The Atlas path fails SOFT by design: if the search indexes are missing,
 * `searchMemories` silently falls back to the recency window rather than
 * erroring, because a missing index must never mean a missing memory. That is
 * the right runtime behaviour and a terrible diagnostic — the owner sets the
 * env var, sees no error, and assumes it took effect while retrieval quietly
 * carries on exactly as before.
 *
 * So the check is explicit and separate. Run it after creating the indexes.
 *
 *   node --env-file=.env scripts/verify-memory-indexes.mjs
 *
 * Exit 0 = the mode is usable · 1 = it would silently fall back.
 */
import { MongoClient } from 'mongodb';

const URI = process.env.MONGODB_URI;
const DB = process.env.MONGODB_DB_NAME || 'autonomous_os_kernel';
const TEXT_INDEX = 'memory_text';
const VECTOR_INDEX = 'memory_vector';

if (!URI) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15_000 });

/** Atlas exposes search indexes through listSearchIndexes; mongod does not. */
async function searchIndexes(db, coll) {
  try {
    return await db.collection(coll).listSearchIndexes().toArray();
  } catch (e) {
    // A plain mongod answers with a command error rather than an empty list.
    return { unsupported: e instanceof Error ? e.message : String(e) };
  }
}

function report(label, list, want) {
  if (!Array.isArray(list)) {
    console.log(`  ${label}: NOT AN ATLAS CLUSTER — ${list.unsupported.slice(0, 120)}`);
    return false;
  }
  const found = list.find((i) => i.name === want);
  if (!found) {
    console.log(`  ${label}: MISSING index "${want}" (have: ${list.map((i) => i.name).join(', ') || 'none'})`);
    return false;
  }
  const ready = found.status === 'READY' || found.queryable === true;
  console.log(`  ${label}: "${want}" present, status=${found.status ?? 'unknown'}${ready ? '' : '  ← still building'}`);
  return ready;
}

try {
  await client.connect();
  const db = client.db(DB);
  console.log(`\nMemory retrieval readiness — db "${DB}"\n`);

  const okText = report('memory_records', await searchIndexes(db, 'memory_records'), TEXT_INDEX);
  const okVector = report('memory_embeddings', await searchIndexes(db, 'memory_embeddings'), VECTOR_INDEX);

  const total = await db.collection('memory_records').countDocuments({ deletedAt: null });
  const embedded = await db.collection('memory_embeddings').countDocuments({});
  const pinned = await db.collection('memory_records').countDocuments({ pinned: true, deletedAt: null });
  console.log(`\n  ${total} live memories · ${embedded} with a vector · ${pinned} pinned`);

  /* The number that decides whether any of this matters. Below the window,
   * the recency path already sees everything and the Atlas path buys nothing
   * except a dependency. */
  if (total <= 400) {
    console.log('  Under the 400-row window: in_process already searches everything.');
  } else {
    console.log(`  OVER the window: ${total - 400} memories are unreachable in in_process mode.`);
  }
  if (embedded < total) {
    console.log(`  ${total - embedded} memories have no vector — run the embedding pass or they are lexical-only.`);
  }

  const usable = okText;   // text index alone already fixes the window
  console.log(`\n  MEMORY_RETRIEVAL_MODE=atlas_hybrid would ${usable ? 'WORK' : 'SILENTLY FALL BACK'}.`);
  if (!usable) {
    console.log('\n  Create on collection "memory_records" (Atlas UI → Search → Create Index):');
    console.log(`    name: ${TEXT_INDEX}   type: Atlas Search`);
    console.log('    fields: subject, content, tags — analyzer lucene.standard');
    console.log('    (Persian needs a language-aware analyzer for stemming; standard still');
    console.log('     matches whole words, which is the majority of the win.)');
    console.log('\n  And on "memory_embeddings" for the semantic half:');
    console.log(`    name: ${VECTOR_INDEX}   type: Vector Search`);
    console.log('    path: vector · similarity: cosine · dimensions: match your embedding model');
  }
  if (okText && !okVector) {
    console.log('\n  Note: the text index alone already removes the window. The vector');
    console.log('  index adds semantic recall ("car" finding "vehicle") and is optional.');
  }
  process.exit(usable ? 0 : 1);
} catch (e) {
  console.error(`\nFailed to reach MongoDB: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  await client.close().catch(() => undefined);
}
