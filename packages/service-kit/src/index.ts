import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyBaseLogger,
} from 'fastify';
import cors from '@fastify/cors';
import {
  FACTORY_ENDPOINTS,
  INTERNAL_TOKEN_HEADER,
  ADMIN_TOKEN_HEADER,
  REQUEST_ID_HEADER,
  buildStatus,
  success,
  failure,
  ERROR_CODES,
  hasValidInternalToken,
  hasValidAdminToken,
  createLogger,
  EventPublisher,
  RegistryClient,
  genId,
  type Logger,
  type ServiceManifest,
  type TaskRequest,
} from '@factory/shared';

export interface TaskHandlerResult {
  taskId: string;
  accepted: boolean;
  [key: string]: unknown;
}

export type TaskHandler = (req: TaskRequest, ctx: ServiceContext) => Promise<TaskHandlerResult>;

/** Context handed to route handlers and the task handler. */
export interface ServiceContext {
  log: Logger;
  publisher: EventPublisher;
  registry: RegistryClient;
  manifest: ServiceManifest;
}

export interface CreateServiceOptions {
  manifest: ServiceManifest;
  port: number;
  internalToken: string;
  adminToken?: string;
  registryUrl?: string;
  eventBusUrl?: string;
  logLevel?: string;
  /** Called for POST /.factory/task. Defaults to a stub that just accepts. */
  taskHandler?: TaskHandler;
  /** Register additional service-specific routes. */
  routes?: (app: FastifyInstance, ctx: ServiceContext) => void | Promise<void>;
}

export interface FactoryService {
  app: FastifyInstance;
  ctx: ServiceContext;
  listen: () => Promise<void>;
  close: () => Promise<void>;
}

/** In-memory ring buffer so /.factory/logs can return recent lines. */
class LogRing {
  private buf: string[] = [];
  constructor(private readonly max = 500) {}
  push(line: string): void {
    this.buf.push(line);
    if (this.buf.length > this.max) this.buf.shift();
  }
  lines(): string[] {
    return [...this.buf];
  }
}

/**
 * Build a fully-wired factory service. Every backend service in the kernel is
 * created through this function so the standard endpoints, auth, registration
 * and lifecycle behave identically everywhere.
 */
export async function createFactoryService(opts: CreateServiceOptions): Promise<FactoryService> {
  const log = createLogger({ serviceId: opts.manifest.serviceId, level: opts.logLevel });
  const logRing = new LogRing();

  const publisher = new EventPublisher({
    eventBusUrl: opts.eventBusUrl ?? '',
    internalToken: opts.internalToken,
    source: opts.manifest.serviceId,
  });
  const registry = new RegistryClient({
    registryUrl: opts.registryUrl ?? '',
    internalToken: opts.internalToken,
  });

  const ctx: ServiceContext = { log, publisher, registry, manifest: opts.manifest };

  const app = Fastify({
    // pino is Fastify's native logger; cast keeps default generics intact.
    loggerInstance: log as unknown as FastifyBaseLogger,
    disableRequestLogging: false,
    genReqId: () => genId('req'),
  });

  await app.register(cors, { origin: true });

  // Echo the request id on every response for traceability.
  app.addHook('onSend', (req, reply, payload, done) => {
    reply.header(REQUEST_ID_HEADER, String(req.id));
    done(null, payload);
  });

  // Production-safe error envelope: never leak stack traces to clients; include
  // a request id so a failure can be correlated with structured logs.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const requestId = String(req.id);
    log.error({ err, requestId }, 'unhandled request error');
    const statusCode = err.statusCode ?? 500;
    const isProd = process.env.NODE_ENV === 'production';
    const code = statusCode >= 500 ? ERROR_CODES.INTERNAL : ERROR_CODES.VALIDATION;
    const message = statusCode >= 500 && isProd ? 'internal error' : err.message;
    reply.header(REQUEST_ID_HEADER, requestId);
    reply.code(statusCode).send(failure(code, message, { requestId }));
  });

  // Capture every log line into the ring buffer for /.factory/logs.
  app.addHook('onResponse', (req, reply, done) => {
    logRing.push(
      `${new Date().toISOString()} ${req.method} ${req.url} -> ${reply.statusCode} (${Math.round(reply.elapsedTime)}ms)`,
    );
    done();
  });

  // Internal-token guard for all /.factory/* routes. /health stays public.
  const requireInternal = (req: FastifyRequest, reply: FastifyReply, done: (e?: Error) => void) => {
    const okInternal = hasValidInternalToken({
      headers: req.headers as Record<string, string | string[] | undefined>,
      expectedInternalToken: opts.internalToken,
    });
    const okAdmin = hasValidAdminToken({
      headers: req.headers as Record<string, string | string[] | undefined>,
      expectedInternalToken: opts.internalToken,
      expectedAdminToken: opts.adminToken,
    });
    if (!okInternal && !okAdmin) {
      reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'Missing or invalid internal token'));
      return;
    }
    done();
  };

  // --- Standard endpoints -------------------------------------------------

  app.get(FACTORY_ENDPOINTS.HEALTH, async () => ({
    status: 'ok' as const,
    serviceId: opts.manifest.serviceId,
  }));

  app.get(FACTORY_ENDPOINTS.MANIFEST, { preHandler: requireInternal }, async () =>
    success(opts.manifest),
  );

  app.get(FACTORY_ENDPOINTS.STATUS, { preHandler: requireInternal }, async () =>
    success(buildStatus({ serviceId: opts.manifest.serviceId, version: opts.manifest.version })),
  );

  app.get(FACTORY_ENDPOINTS.CAPABILITIES, { preHandler: requireInternal }, async () =>
    success({ capabilities: opts.manifest.capabilities }),
  );

  app.get(FACTORY_ENDPOINTS.LOGS, { preHandler: requireInternal }, async () =>
    success({ lines: logRing.lines() }),
  );

  const taskHandler: TaskHandler =
    opts.taskHandler ??
    (async (req) => ({ taskId: req.taskId ?? genId('task'), accepted: true }));

  app.post(FACTORY_ENDPOINTS.TASK, { preHandler: requireInternal }, async (req, reply) => {
    const body = req.body as TaskRequest;
    if (!body || typeof body.goal !== 'string' || body.goal.length === 0) {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'goal is required'));
    }
    try {
      const result = await taskHandler(body, ctx);
      return success(result);
    } catch (e) {
      log.error({ err: e }, 'task handler failed');
      return reply.code(500).send(failure(ERROR_CODES.INTERNAL, 'task handler failed'));
    }
  });

  // --- Service-specific routes -------------------------------------------
  if (opts.routes) await opts.routes(app, ctx);

  const listen = async (): Promise<void> => {
    await app.listen({ port: opts.port, host: '0.0.0.0' });
    log.info({ port: opts.port, domain: opts.manifest.domain }, 'service listening');
    // Best-effort self-registration; service runs even if registry is down.
    const registered = await registry.register(opts.manifest);
    if (registered) log.info('registered with service-registry');
    else log.warn('service-registry unreachable; continuing unregistered');
  };

  const close = async (): Promise<void> => {
    await app.close();
  };

  // Graceful shutdown on termination signals.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      log.info({ sig }, 'shutting down');
      void close().finally(() => process.exit(0));
    });
  }

  return { app, ctx, listen, close };
}

export { INTERNAL_TOKEN_HEADER, ADMIN_TOKEN_HEADER };
export type { FastifyInstance, FastifyReply, FastifyRequest, ServiceManifest };
