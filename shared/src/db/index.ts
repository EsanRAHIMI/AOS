import { MongoClient, type Db, type Collection, type Document } from 'mongodb';
import { COLLECTIONS, type CollectionName } from '../constants/index.js';

/**
 * MongoDB Atlas connection layer. MongoDB Atlas is the required primary data
 * store for the kernel — text, structured data, logs, task records, memory,
 * documents, agent traces and system state all live here.
 *
 * One MongoClient per process (the driver pools connections internally).
 */
export interface MongoConfig {
  uri: string;
  dbName: string;
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(config: MongoConfig): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.uri, {
    retryWrites: true,
    // Keep pool modest; each service is a separate container.
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  db = client.db(config.dbName);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Mongo not connected. Call connectMongo() during startup.');
  return db;
}

/** Typed collection accessor keyed by the canonical COLLECTIONS names. */
export function collection<T extends Document = Document>(name: CollectionName): Collection<T> {
  return getDb().collection<T>(name);
}

export async function pingMongo(): Promise<boolean> {
  try {
    await getDb().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}

/**
 * Test-only seam: inject a Db (or a compatible fake) so handlers/pipelines can
 * run in-process without a live MongoDB. Never called in production code paths.
 */
export function setTestDb(testDb: Db): void {
  db = testDb;
}

export { COLLECTIONS };
export type { Db, Collection };

// K1.4a — scope-by-construction data access (master-direction §C.5).
export { scopedCollection, type ScopedContext, type ScopedCollection } from './scoped.js';
