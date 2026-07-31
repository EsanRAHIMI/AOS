import type {
  Collection,
  DeleteOptions,
  DeleteResult,
  Document,
  Filter,
  FindOptions,
  FindCursor,
  InsertOneOptions,
  InsertOneResult,
  OptionalUnlessRequiredId,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithId,
} from 'mongodb';
import type { CollectionName } from '../constants/index.js';
import { collection as rawCollection } from './index.js';

/**
 * Repository view for records owned by one authenticated actor.
 *
 * Several integrations predate ScopeFieldsSchema and use `actorId` as their
 * durable partition key. This adapter gives those collections the same
 * by-construction isolation guarantees as scopedCollection without rewriting
 * persisted records or weakening their existing indexes.
 */
export interface ActorScopedCollection<T extends Document> {
  readonly actorId: string;
  find(filter?: Filter<T>, options?: FindOptions<T>): FindCursor<WithId<T>>;
  findOne(filter?: Filter<T>, options?: FindOptions<T>): Promise<WithId<T> | null>;
  countDocuments(filter?: Filter<T>): Promise<number>;
  insertOne(doc: OptionalUnlessRequiredId<T>, options?: InsertOneOptions): Promise<InsertOneResult<T>>;
  updateOne(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult<T>>;
  updateMany(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult<T>>;
  deleteOne(filter?: Filter<T>, options?: DeleteOptions): Promise<DeleteResult>;
  deleteMany(filter?: Filter<T>, options?: DeleteOptions): Promise<DeleteResult>;
}

function requireActorId(actorId: string): void {
  if (!actorId?.trim()) throw new Error('fail closed: actorScopedCollection requires a non-empty actorId');
}

function mergeActorFilter<T extends Document>(actorId: string, filter?: Filter<T>): Filter<T> {
  const guard = { actorId } as unknown as Filter<T>;
  if (!filter || Object.keys(filter).length === 0) return guard;
  return { $and: [guard, filter] } as Filter<T>;
}

function assertActorWrite(actorId: string, value: unknown): void {
  if (value !== undefined && value !== actorId) {
    throw new Error(`fail closed: actorId is immutable and must equal authenticated actor "${actorId}"`);
  }
}

function assertUpdateActor<T extends Document>(actorId: string, update: UpdateFilter<T>): void {
  for (const [operator, body] of Object.entries(update)) {
    if (!operator.startsWith('$') || !body || typeof body !== 'object') continue;
    const actorValue = (body as Record<string, unknown>).actorId;
    if (actorValue !== undefined) {
      if (operator !== '$set' && operator !== '$setOnInsert') {
        throw new Error('fail closed: actorId cannot be modified by an update operator');
      }
      assertActorWrite(actorId, actorValue);
    }
  }
}

export function actorScopedCollection<T extends Document = Document>(
  name: CollectionName,
  actorId: string,
  raw?: Collection<T>,
): ActorScopedCollection<T> {
  requireActorId(actorId);
  const col = (): Collection<T> => raw ?? rawCollection<T>(name);

  return {
    actorId,
    find: (filter, options) => col().find(mergeActorFilter(actorId, filter), options),
    findOne: (filter, options) => col().findOne(mergeActorFilter(actorId, filter), options),
    countDocuments: (filter) => col().countDocuments(mergeActorFilter(actorId, filter)),
    insertOne: (doc, options) => {
      assertActorWrite(actorId, (doc as Record<string, unknown>).actorId);
      return col().insertOne({ ...doc, actorId } as OptionalUnlessRequiredId<T>, options);
    },
    updateOne: (filter, update, options) => {
      assertUpdateActor(actorId, update);
      return col().updateOne(mergeActorFilter(actorId, filter), update, options);
    },
    updateMany: (filter, update, options) => {
      assertUpdateActor(actorId, update);
      return col().updateMany(mergeActorFilter(actorId, filter), update, options);
    },
    deleteOne: (filter, options) => col().deleteOne(mergeActorFilter(actorId, filter), options),
    deleteMany: (filter, options) => col().deleteMany(mergeActorFilter(actorId, filter), options),
  };
}

/**
 * Compatibility repository for mature modules whose public functions already
 * carry actorId in every document/filter. Unlike a raw Mongo collection it
 * rejects any operation that fails to name exactly one actor partition.
 */
export function actorPartitionedCollection<T extends Document = Document>(
  name: CollectionName,
  raw?: Collection<T>,
): Pick<Collection<T>, 'find' | 'findOne' | 'countDocuments' | 'insertOne' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany'> {
  const col = (): Collection<T> => raw ?? rawCollection<T>(name);
  const actorFrom = (value: unknown): string => {
    const actorId = value && typeof value === 'object' ? (value as Record<string, unknown>).actorId : undefined;
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new Error(`fail closed: ${name} operation requires an explicit actorId partition`);
    }
    return actorId;
  };
  const checkUpdate = (actorId: string, update: UpdateFilter<T>): void => assertUpdateActor(actorId, update);

  return {
    find: ((filter: Filter<T>, options?: FindOptions<T>) => { actorFrom(filter); return col().find(filter, options); }) as Collection<T>['find'],
    findOne: ((filter: Filter<T>, options?: FindOptions<T>) => { actorFrom(filter); return col().findOne(filter, options); }) as Collection<T>['findOne'],
    countDocuments: ((filter: Filter<T>) => { actorFrom(filter); return col().countDocuments(filter); }) as Collection<T>['countDocuments'],
    insertOne: ((doc: OptionalUnlessRequiredId<T>, options?: InsertOneOptions) => {
      actorFrom(doc); return col().insertOne(doc, options);
    }) as Collection<T>['insertOne'],
    updateOne: ((filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions) => {
      const actorId = actorFrom(filter); checkUpdate(actorId, update); return col().updateOne(filter, update, options);
    }) as Collection<T>['updateOne'],
    updateMany: ((filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions) => {
      const actorId = actorFrom(filter); checkUpdate(actorId, update); return col().updateMany(filter, update, options);
    }) as Collection<T>['updateMany'],
    deleteOne: ((filter: Filter<T>, options?: DeleteOptions) => { actorFrom(filter); return col().deleteOne(filter, options); }) as Collection<T>['deleteOne'],
    deleteMany: ((filter: Filter<T>, options?: DeleteOptions) => { actorFrom(filter); return col().deleteMany(filter, options); }) as Collection<T>['deleteMany'],
  };
}

/** A fixed-key partition for legacy schemas that use ownerId/userId instead of actorId. */
export function keyedScopedCollection<T extends Document = Document>(
  name: CollectionName,
  key: string,
  value: string,
  raw?: Collection<T>,
): ActorScopedCollection<T> {
  if (!key?.trim() || !value?.trim()) throw new Error('fail closed: keyedScopedCollection requires a key and value');
  const col = (): Collection<T> => raw ?? rawCollection<T>(name);
  const merge = (filter?: Filter<T>): Filter<T> => {
    const guard = { [key]: value } as Filter<T>;
    return !filter || Object.keys(filter).length === 0 ? guard : { $and: [guard, filter] } as Filter<T>;
  };
  const assertDoc = (doc: Record<string, unknown>): void => {
    if (doc[key] !== undefined && doc[key] !== value) throw new Error(`fail closed: ${key} is immutable`);
  };
  const assertUpdate = (update: UpdateFilter<T>): void => {
    for (const body of Object.values(update)) if (body && typeof body === 'object') assertDoc(body as Record<string, unknown>);
  };
  return {
    actorId: value,
    find: (filter, options) => col().find(merge(filter), options),
    findOne: (filter, options) => col().findOne(merge(filter), options),
    countDocuments: (filter) => col().countDocuments(merge(filter)),
    insertOne: (doc, options) => { assertDoc(doc as Record<string, unknown>); return col().insertOne({ ...doc, [key]: value } as OptionalUnlessRequiredId<T>, options); },
    updateOne: (filter, update, options) => { assertUpdate(update); return col().updateOne(merge(filter), update, options); },
    updateMany: (filter, update, options) => { assertUpdate(update); return col().updateMany(merge(filter), update, options); },
    deleteOne: (filter, options) => col().deleteOne(merge(filter), options),
    deleteMany: (filter, options) => col().deleteMany(merge(filter), options),
  };
}
