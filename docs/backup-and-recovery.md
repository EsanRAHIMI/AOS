# Backup, Recovery & Production Safety

This runbook protects the live AOS kernel and the future personal operating
layer. Recovery must be rehearsed before the system is trusted with more of
any user's, organization's, department's, or citizen's real data.

## MongoDB Atlas

MongoDB is the source of truth for tasks, events, approvals, memory, governance,
learning, voice/operator sessions, workspace runs, incidents, and evidence metadata.
Future user/tenant data must be recoverable per tenant where possible, not only
as one global restore.

- Enable Atlas Cloud Backup with continuous backup and daily snapshots.
- Keep at least 7 daily and 4 weekly snapshots.
- Test restore into staging before touching production.
- Portable backup:
  `mongodump --uri "$MONGODB_URI" --archive=backup-$(date +%F).gz --gzip`
- Portable restore:
  `mongorestore --uri "$MONGODB_URI" --archive=backup.gz --gzip`

## S3 / Assets

- Enable bucket versioning.
- Use lifecycle rules for noncurrent versions.
- Consider cross-region replication when artifacts become business-critical.
- Restore Mongo metadata and S3 versions together for consistent recovery.

## Secrets

Rotate these through provider console + Dokploy env + redeploy:

- `FACTORY_INTERNAL_TOKEN` on all services together.
- `FACTORY_ADMIN_TOKEN` on gateway and dashboard together.
- `DASHBOARD_SESSION_SECRET` to invalidate sessions.
- Password hashes generated through `scripts/hash-password.mjs`.
- `MONGODB_URI`, AWS keys, GitHub token, LLM provider keys, Dokploy token.

After rotation, run security checks and service health verification.

## Emergency Safe Mode

Enable safe mode when a risky condition appears:

1. Dashboard Security page or gateway safe-mode endpoint.
2. Mutations, deploys, repairs, governance changes, and external actions stop.
3. Reads, monitoring, reports, recommendations, and evidence review continue.
4. Rotate/recover/verify.
5. Disable safe mode only after owner approval.

## Rollback

- One service rollback: redeploy previous Dokploy build/commit.
- Env rollback: restore previous env and redeploy.
- Workspace promotion rollback: use preserved snapshot/migration record.
- Data rollback: restore to staging first, inspect, then plan production restore.
- Tenant/user rollback: restore or replay only the affected scope when the data model supports it.

## Recovery Drill Cadence

- Monthly: restore Mongo snapshot to staging.
- Monthly: verify S3 version recovery.
- Quarterly: rotate secrets in staging.
- Quarterly: simulate service rollback and safe-mode incident.
- Before personal, organizational, or public-service connector writes: run a full restore and approval-flow drill.
