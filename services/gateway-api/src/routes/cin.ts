/**
 * Gateway routes — CIN group (CIN-1, D-179).
 *
 * HTTP surface over shared/src/cin: living entity graph, verifiable claims,
 * tamper-evident ledger. Owner/internal-guarded like the rest of the control
 * plane; private profile sections are only returned to guarded callers
 * (which is everyone who passes guard() in single-operator mode — the
 * visibility filter is exercised for future public/network surfaces).
 * SECURITY: no route returns private keys (trust module never exposes them).
 */
import {
  CinEntityType,
  CinCreateEntityBody, CinUpdateSectionBody, CinSetStatusBody,
  CinCreateRelationBody, CinIssueClaimBody, CinRevokeClaimBody, zodIssuesMessage,
  createEntity, getEntity, listEntities, updateEntitySection, setEntityStatus,
  createRelation, endRelation, getEntityGraph,
  issueClaim, getClaim, listClaims, verifyClaim, revokeClaim, getPublicKey, claimToW3cVc,
  listLedger, verifyChain,
  failure, success, ERROR_CODES,
} from '@factory/shared';
import type { CinActor } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, FastifyReplyLike } from './deps.js';

export function registerCinRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { guard, deny } = deps;

  /** Single-operator mode: the guarded caller acts as the owner. Multi-tenant
   *  actor resolution (issuer-control checks) lands with CIN-3. */
  const actorFor = (): CinActor => ({ actorId: 'owner', scope: 'user', tenantId: null });

  const handle = async (reply: FastifyReplyLike, fn: () => Promise<unknown>) => {
    try {
      return success(await fn());
    } catch (err) {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, err instanceof Error ? err.message : 'cin operation failed'));
    }
  };

  // --- Entities ---------------------------------------------------------
  app.post('/v1/cin/entities', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const parsed = CinCreateEntityBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, zodIssuesMessage(parsed.error)));
    return handle(reply, () => createEntity(actorFor(), parsed.data));
  });

  app.get('/v1/cin/entities', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { entityType?: string; status?: string; q?: string };
    const entityType = q.entityType ? CinEntityType.safeParse(q.entityType) : null;
    if (entityType && !entityType.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid entityType'));
    return success({ entities: await listEntities({ entityType: entityType?.success ? entityType.data : undefined, status: q.status, q: q.q }) });
  });

  app.get('/v1/cin/entities/:id', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const entity = await getEntity(id, { includePrivate: true });
    if (!entity) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `entity ${id} not found`));
    return success({ entity, publicKey: await getPublicKey(id) });
  });

  app.put('/v1/cin/entities/:id/sections/:section', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id, section } = req.params as { id: string; section: string };
    const parsed = CinUpdateSectionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, zodIssuesMessage(parsed.error)));
    return handle(reply, () => updateEntitySection(actorFor(), id, section, parsed.data.data, parsed.data.visibility));
  });

  app.post('/v1/cin/entities/:id/status', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const body = CinSetStatusBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'status must be active|suspended|archived'));
    return handle(reply, async () => { await setEntityStatus(actorFor(), id, body.data.status); return { entityId: id, status: body.data.status }; });
  });

  app.get('/v1/cin/entities/:id/graph', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const graph = await getEntityGraph(id, { includePrivate: true });
    if (!graph) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `entity ${id} not found`));
    return success(graph);
  });

  // --- Relations --------------------------------------------------------
  app.post('/v1/cin/relations', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const parsed = CinCreateRelationBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, zodIssuesMessage(parsed.error)));
    return handle(reply, () => createRelation(actorFor(), parsed.data));
  });

  app.post('/v1/cin/relations/:id/end', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    return handle(reply, async () => { await endRelation(actorFor(), id); return { relationId: id, status: 'ended' }; });
  });

  // --- Claims -----------------------------------------------------------
  app.post('/v1/cin/claims', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const parsed = CinIssueClaimBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, zodIssuesMessage(parsed.error)));
    return handle(reply, () => issueClaim(parsed.data));
  });

  app.get('/v1/cin/claims', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { subjectEntityId?: string; issuerEntityId?: string; claimType?: string };
    return success({ claims: await listClaims(q) });
  });

  app.get('/v1/cin/claims/:id', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const claim = await getClaim(id);
    if (!claim) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `claim ${id} not found`));
    return success({ claim });
  });

  app.get('/v1/cin/claims/:id/vc', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const claim = await getClaim(id);
    if (!claim) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `claim ${id} not found`));
    const pub = await getPublicKey(claim.issuerEntityId);
    if (!pub) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'issuer public key not found'));
    return success({ verifiableCredential: claimToW3cVc(claim, pub.publicKeyPem) });
  });

  app.get('/v1/cin/claims/:id/verify', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    return success(await verifyClaim(id));
  });

  app.post('/v1/cin/claims/:id/revoke', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const body = CinRevokeClaimBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'reason is required'));
    return handle(reply, () => revokeClaim(id, body.data.reason));
  });

  // --- Ledger -----------------------------------------------------------
  app.get('/v1/cin/ledger', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { limit?: string; afterSeq?: string };
    return success({ records: await listLedger({ limit: q.limit ? Number(q.limit) : undefined, afterSeq: q.afterSeq ? Number(q.afterSeq) : undefined }) });
  });

  app.get('/v1/cin/ledger/verify', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return success(await verifyChain());
  });
}
