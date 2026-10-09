import {
  FAMILY_FINANCE_ACTOR_ID,
  connectFamilyFinance,
  disconnectFamilyFinance,
  familyFinanceStatus,
  familyFinanceVaultAvailability,
  readFamilyFinance,
  selectFamilyFinanceHousehold,
  failure, success, ERROR_CODES,
} from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { FastifyReplyLike, GatewayDeps } from './deps.js';

const OWNER = FAMILY_FINANCE_ACTOR_ID;

export function registerFamilyFinanceRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { guard, deny } = deps;
  const handle = async (reply: FastifyReplyLike, fn: () => Promise<unknown>) => {
    try {
      return success(await fn());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = /not_connected|family_not_selected/.test(message) ? 409 : 400;
      return reply.code(code).send(failure(ERROR_CODES.INTERNAL, message));
    }
  };

  app.get('/v1/finance/family/status', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return success(await familyFinanceStatus(OWNER));
  });

  app.post<{ Body: { identifier?: string; password?: string } }>('/v1/finance/family/connect', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const vault = familyFinanceVaultAvailability();
    if (!vault.configured) return reply.code(400).send(failure(ERROR_CODES.INTERNAL, vault.reason));
    return handle(reply, () => connectFamilyFinance({
      identifier: String(req.body?.identifier ?? ''),
      password: String(req.body?.password ?? ''),
      actorId: OWNER,
    }));
  });

  app.post<{ Body: { familyId?: string } }>('/v1/finance/family/select', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, () => selectFamilyFinanceHousehold(String(req.body?.familyId ?? ''), OWNER));
  });

  app.post('/v1/finance/family/disconnect', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, () => disconnectFamilyFinance(OWNER));
  });

  app.get<{ Querystring: { month?: string } }>('/v1/finance/family/snapshot', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, () => readFamilyFinance({ month: req.query?.month, actorId: OWNER }));
  });
}
