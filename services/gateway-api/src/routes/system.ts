/**
 * Gateway routes — system group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { success } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerSystemRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    env,
    guard,
    deny,
    tasks,
    approvals,
  } = deps;

      // --- System status --------------------------------------------------
      app.get('/v1/system/status', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const [taskCount, pendingApprovals] = await Promise.all([
          tasks.countDocuments({}),
          approvals.countDocuments({ status: 'pending' }),
        ]);
        return success({ taskCount, pendingApprovals, env: env.FACTORY_ENV });
      });
}
