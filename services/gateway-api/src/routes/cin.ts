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
  createDocument, listDocuments, getDocument, updateDocument, archiveDocument,
  attachDocumentFile, summariseDocuments,
  documentStorage, documentStorageAvailability, documentObjectKey,
  CinCreateDocumentBody, CinUpdateDocumentBody, CinUploadDocumentFileBody,
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
    return success({ entities: await listEntities(actorFor(), { entityType: entityType?.success ? entityType.data : undefined, status: q.status, q: q.q }) });
  });

  app.get('/v1/cin/entities/:id', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const entity = await getEntity(actorFor(), id, { includePrivate: true });
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
    const graph = await getEntityGraph(actorFor(), id, { includePrivate: true });
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

  /* --------------------------- the owner's self --------------------------
   * One place that answers "which CIN entity am I?". Without it every client
   * would have to guess by name, which is exactly how identity surfaces drift
   * apart. Resolves the person entity the genesis seed created; honest null
   * when the graph has not been seeded yet. */
  app.get('/v1/me/entity', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const people = await listEntities(actorFor(), { entityType: 'person' });
    const owner = people.find((e) => e.tags.includes('owner') || e.tags.includes('founder')) ?? people[0] ?? null;
    if (!owner) {
      return success({
        entity: null, publicKey: null, documents: null,
        hint: 'no person entity yet — run scripts/cin-genesis-seed.mjs',
      });
    }
    const [graph, publicKey, claimsAbout, docs] = await Promise.all([
      getEntityGraph(actorFor(), owner.entityId, { includePrivate: true }),
      getPublicKey(owner.entityId),
      listClaims({ subjectEntityId: owner.entityId }),
      summariseDocuments(actorFor(), owner.entityId),
    ]);
    return success({
      entity: graph?.entity ?? owner,
      relations: graph?.relations ?? [],
      neighbours: graph?.neighbors ?? [],
      publicKey,
      claims: claimsAbout,
      documents: docs,
      storage: documentStorageAvailability(),
    });
  });

  /* ------------------------------ documents ------------------------------ */

  app.get('/v1/cin/documents', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { ownerEntityId?: string; docType?: string; status?: string; includeArchived?: string };
    const documents = await listDocuments(actorFor(), {
      ownerEntityId: q.ownerEntityId,
      docType: q.docType as never,
      status: q.status as never,
      includeArchived: q.includeArchived === '1',
    });
    return success({ documents, storage: documentStorageAvailability() });
  });

  app.post('/v1/cin/documents', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const body = CinCreateDocumentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, zodIssuesMessage(body.error)));
    const ownerEntityId = String((req.body as { ownerEntityId?: string }).ownerEntityId ?? '');
    if (!ownerEntityId) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'ownerEntityId is required'));
    return handle(reply, () => createDocument(actorFor(), { ...body.data, ownerEntityId }));
  });

  app.patch('/v1/cin/documents/:id', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const body = CinUpdateDocumentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, zodIssuesMessage(body.error)));
    return handle(reply, () => updateDocument(actorFor(), id, body.data));
  });

  app.post('/v1/cin/documents/:id/archive', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    return handle(reply, async () => { await archiveDocument(actorFor(), id); return { docId: id, status: 'archived' }; });
  });

  /**
   * Attach a file. Object storage is OPTIONAL in most deployments, so this is
   * the one place that must be loud about it: when S3 is not configured the
   * route answers 501 with the exact missing variables instead of failing
   * obscurely or pretending the upload worked. The document record itself
   * stays fully usable without a file.
   */
  app.post('/v1/cin/documents/:id/file', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const availability = documentStorageAvailability();
    if (!availability.configured) {
      return reply.code(501).send(failure('not_configured', availability.reason));
    }
    const body = CinUploadDocumentFileBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, zodIssuesMessage(body.error)));
    const doc = await getDocument(actorFor(), id);
    if (!doc) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `document ${id} not found`));
    const storage = documentStorage();
    if (!storage) return reply.code(501).send(failure('not_configured', availability.reason));
    return handle(reply, async () => {
      const buffer = Buffer.from(body.data.contentBase64, 'base64');
      const key = documentObjectKey(doc.ownerEntityId, doc.docId, body.data.filename);
      const put = await storage.put(key, buffer, body.data.mimeType);
      return attachDocumentFile(actorFor(), id, {
        objectId: key, bucket: put.bucket, key: put.key,
        mimeType: body.data.mimeType, size: put.size, originalName: body.data.filename,
      });
    });
  });

  /** Time-limited signed download URL — never a public object URL. */
  app.get('/v1/cin/documents/:id/url', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const doc = await getDocument(actorFor(), id);
    if (!doc) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `document ${id} not found`));
    if (!doc.file) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'this document has no stored file'));
    const storage = documentStorage();
    if (!storage) return reply.code(501).send(failure('not_configured', documentStorageAvailability().reason));
    return handle(reply, async () => ({ url: await storage.signedGetUrl(doc.file!.key) }));
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
