import { z } from 'zod';
import { IsoDate } from './common.js';

/** A system event published to the event bus and persisted in `events`. */
export const SystemEventSchema = z.object({
  eventId: z.string(),
  type: z.string(),                       // one of EVENT_TYPES
  source: z.string(),                     // emitting serviceId
  taskId: z.string().nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: IsoDate,
});
export type SystemEvent = z.infer<typeof SystemEventSchema>;

/** Body accepted when publishing an event. */
export const PublishEventSchema = SystemEventSchema.omit({
  eventId: true,
  createdAt: true,
});
export type PublishEvent = z.infer<typeof PublishEventSchema>;
