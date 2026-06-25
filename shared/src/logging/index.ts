import pino, { type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  serviceId: string;
  level?: string;
  pretty?: boolean;
}

/**
 * Structured JSON logger. Every log line carries serviceId so logs are
 * traceable across services once aggregated. Use pretty output only in local
 * development.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const level = opts.level ?? process.env.LOG_LEVEL ?? 'info';
  const usePretty = opts.pretty ?? process.env.NODE_ENV !== 'production';
  return pino({
    level,
    base: { serviceId: opts.serviceId },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(usePretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }
      : {}),
  });
}
