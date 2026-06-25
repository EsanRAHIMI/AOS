import { INTERNAL_TOKEN_HEADER } from '../constants/index.js';
import type { PublishEvent } from '../schemas/event.js';

/**
 * Lightweight client for publishing events to the event-bus-service over HTTP.
 * Services never share an in-process bus — they post to the bus container,
 * which fans out via SSE and persists to MongoDB. Failures are swallowed and
 * logged by the caller: event publishing must never break the main flow.
 */
export interface EventPublisherConfig {
  eventBusUrl: string;
  internalToken: string;
  source: string;
}

export class EventPublisher {
  constructor(private readonly config: EventPublisherConfig) {}

  async publish(event: Omit<PublishEvent, 'source'>): Promise<boolean> {
    if (!this.config.eventBusUrl) return false;
    try {
      const res = await fetch(`${this.config.eventBusUrl}/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: this.config.internalToken,
        },
        body: JSON.stringify({ ...event, source: this.config.source }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
