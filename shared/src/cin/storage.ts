/**
 * CIN document storage seam (CIN-1b, D-185).
 *
 * One job: answer "can this kernel actually store a file right now?" honestly,
 * and if yes, store it. S3 credentials are optional in most deployments, so
 * the answer must be an explicit `not_configured` — never a silent failure and
 * never a pretend success. The document registry works fully without it; only
 * the attachment step needs a bucket.
 */
import { FileStorage } from '../storage/index.js';

export interface StorageAvailability {
  configured: boolean;
  /** Exact, human-readable reason when unavailable — shown in the UI. */
  reason: string;
  bucket: string;
  region: string;
}

const REQUIRED = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET'] as const;

export function documentStorageAvailability(env: NodeJS.ProcessEnv = process.env): StorageAvailability {
  const missing = REQUIRED.filter((k) => !env[k]);
  return {
    configured: missing.length === 0,
    reason: missing.length === 0 ? '' : `object storage not configured — missing ${missing.join(', ')}`,
    bucket: env.AWS_S3_BUCKET ?? '',
    region: env.AWS_REGION ?? '',
  };
}

/** Null when storage is not configured; the caller reports the reason. */
export function documentStorage(env: NodeJS.ProcessEnv = process.env): FileStorage | null {
  const availability = documentStorageAvailability(env);
  if (!availability.configured) return null;
  return new FileStorage({
    region: env.AWS_REGION!,
    bucket: env.AWS_S3_BUCKET!,
    accessKeyId: env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
  });
}

/**
 * Deterministic, owner-scoped key layout: factory/documents/{entity}/{doc}/…
 *
 * The filename comes from the browser, so it is untrusted. S3 keys are opaque
 * strings (not filesystem paths), but plenty of tooling — sync clients,
 * mirrors, local caches — does treat them as paths, so a key must never carry
 * a traversal segment or whitespace. Everything outside `[A-Za-z0-9._-]`
 * becomes `_`, dot runs collapse to a single dot, and leading separators are
 * dropped.
 */
export function documentObjectKey(ownerEntityId: string, docId: string, filename: string): string {
  const safe = filename
    .replace(/[^\w.\-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .slice(-120) || 'file';
  return `factory/documents/${ownerEntityId}/${docId}/${Date.now()}_${safe}`;
}
