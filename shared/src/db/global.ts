import type { Collection, Document } from 'mongodb';
import type { CollectionName } from '../constants/index.js';
import { collection as rawCollection } from './index.js';

/**
 * Explicit access to kernel-global records that do not contain human scope.
 * Calling this function is an architectural declaration and is kept rare by
 * the scope-boundary gate. Human or tenant data must use a scoped repository.
 */
export function globalCollection<T extends Document = Document>(name: CollectionName): Collection<T> {
  return rawCollection<T>(name);
}
