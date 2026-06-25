import { z } from 'zod';

/** ISO-8601 timestamp string. Stored as string for portability across services. */
export const IsoDate = z.string().datetime({ offset: true });

/** Opaque prefixed id, e.g. "task_a1b2c3". */
export const PrefixedId = z.string().min(3).regex(/^[a-z]+_[A-Za-z0-9]+$/);

/** Audit fields present on most persisted documents. */
export const Timestamps = z.object({
  createdAt: IsoDate,
  updatedAt: IsoDate,
});

export const Priority = z.enum(['low', 'normal', 'high', 'critical']);
export type Priority = z.infer<typeof Priority>;

export const Confidence = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof Confidence>;
