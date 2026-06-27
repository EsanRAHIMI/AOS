# Backup, Recovery & Production Safety

Operational runbook for keeping the live kernel (`*.simorx.com`) safe and recoverable.
Phase 12 adds authentication, RBAC, rate limiting, an env/secret audit, a security event
trail, and an emergency safe mode. This document covers the human side: backups, rotation,
rollback, and emergency procedures.

## 1. MongoDB Atlas backup

MongoDB Atlas is the single source of truth (tasks, agents, governance, learning, security).

- **Automated:** enable Atlas Cloud Backup (continuous + daily snapshots) on the cluster.
  Set a retention window (≥7 daily, ≥4 weekly). Atlas → Cluster → Backup.
- **Manual / portable:** `mongodump --uri "$MONGODB_URI" --archive=backup-$(date +%F).gz --gzip`
- **Restore:** `mongorestore --uri "$MONGODB_URI" --archive=backup.gz --gzip` (test into a
  staging DB first; never restore straight over production without a snapshot).
- **PITR:** Atlas point-in-time recovery covers the retention window for accidental deletes.

## 2. AWS S3 backup

S3 stores files/artifacts/screenshots; metadata lives in MongoDB (`s3_objects`, `files`).

- Enable **S3 Versioning** on the bucket so overwrites/deletes are recoverable.
- Enable a lifecycle rule to expire old noncurrent versions (cost control).
- Optional: cross-region replication for disaster recovery.
- Because object metadata is in MongoDB, a consistent recovery = restore Mongo + keep S3
  versioning intact.

## 3. Secret rotation

Run the env/secret audit first: **dashboard → Security → Env Health** (or `GET /v1/security/env`).

Rotate by updating the value in Dokploy env, then redeploying the affected services:

- `FACTORY_INTERNAL_TOKEN` — rotate on ALL services at once (shared secret). Stagger carefully:
  set new value everywhere, redeploy, verify `/health` + service registration.
- `FACTORY_ADMIN_TOKEN` — rotate on the gateway and the dashboard together.
- `DASHBOARD_SESSION_SECRET` — rotating invalidates all existing sessions (everyone re-logs in).
- `DASHBOARD_*_PASSWORD_HASH` — regenerate with `node scripts/hash-password.mjs '<password>'`.
- `MONGODB_URI`, `AWS_*`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` — rotate at the
  provider, update Dokploy env, redeploy.

After rotation, re-run the security check (**Security → Run security check**) and confirm it passes.

## 4. Deployment rollback (Dokploy)

Each service deploys independently from GitHub via Dokploy.

- **Roll back code:** in Dokploy, redeploy the previous successful commit/build for the service.
- **Roll back config:** revert the env change in Dokploy and redeploy.
- **Health gates:** after any deploy, confirm `GET /health` (public) returns ok and the service
  re-registers (dashboard → Services). The gateway’s `/v1/security/check` should still pass.
- Because services are independent, roll back only the affected one; the rest keep running.

## 5. Dokploy service restart checklist

1. Identify the service (dashboard → Monitor / Services).
2. Restart it in Dokploy.
3. Verify `/health` is ok and it appears registered in the registry.
4. Verify `/.factory/manifest` responds with the internal token (it must NOT be public).
5. Confirm the dashboard can reach it (no new incidents on `/incidents`).

## 6. Emergency: enable safe mode

`AUTONOMY_SAFE_MODE` (env default) is mirrored into `system_settings` and toggled at runtime.

- **Enable now:** dashboard → Security → Safe Mode → *Enable safe mode* (owner only), or
  `POST /v1/security/safe-mode {"enabled":true}` with the admin token + owner role header.
- **Effect:** the gateway and dashboard refuse all mutation/deploy/repair/governance actions and
  log a security event for each blocked attempt. Reads, monitoring, reports and recommendations
  continue. A banner shows across the dashboard.
- **Disable:** same page → *Disable safe mode* (owner only). Mutations resume immediately.
- **Boot default:** set `AUTONOMY_SAFE_MODE=true` in Dokploy to start a service locked down; the
  runtime setting then takes over once an owner toggles it.

## 7. Incident response quick path

1. **Contain:** enable safe mode.
2. **Assess:** Security → Events (denials, failed logins, rate-limit hits) and Audit Log.
3. **Rotate** any exposed secret (section 3); redeploy.
4. **Recover** data if needed (sections 1–2).
5. **Verify:** run a security check; confirm it passes.
6. **Resume:** disable safe mode.
