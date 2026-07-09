import { z } from 'zod';
import { IsoDate } from './common.js';
import { ScopeFieldsSchema } from './scope.js';

/** A system event published to the event bus and persisted in `events`. */
export const SystemEventSchema = z.object({
  eventId: z.string(),
  type: z.string(),                       // one of EVENT_TYPES
  source: z.string(),                     // emitting serviceId
  taskId: z.string().nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: IsoDate,
}).merge(ScopeFieldsSchema).extend({
  // K1.1 contract fix — ScopeFieldsSchema also declares an OPTIONAL `source`
  // (scope provenance), which silently overrode the REQUIRED event `source`
  // (emitting serviceId) when Phase AA merged scope fields in: the bus was
  // accepting anonymous events. Caught by the first contract test suite.
  // Event `source` wins and is re-asserted required; EventPublisher always
  // stamps it, so no legitimate publisher is affected.
  source: z.string(),
});
export type SystemEvent = z.infer<typeof SystemEventSchema>;

/** Body accepted when publishing an event. */
export const PublishEventSchema = SystemEventSchema.omit({
  eventId: true,
  createdAt: true,
});
export type PublishEvent = z.infer<typeof PublishEventSchema>;
