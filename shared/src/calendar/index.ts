/**
 * Google Calendar + Tasks integration (D-192).
 *
 * In-house REST integration rather than an SDK or the (still preview) official
 * MCP server: the mirror in Atlas is what the calendar page, the heartbeat and
 * the living loop read, so the system keeps working — and keeps warning about
 * tomorrow's meeting — when Google is slow, rate-limiting or unreachable.
 *
 * "Reminders" are Google Tasks with a due date. Google migrated Reminders into
 * Tasks (Calendar/Assistant 2023, Keep 2025) and publishes no Reminders API.
 */
export * from './tokens.js';
export * from './google.js';
export * from './sync.js';
export * from './write.js';
export * from './notes.js';
