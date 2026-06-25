# MongoDB Atlas

1. Create a project + cluster (M10+ recommended for production).
2. Create a DB user; restrict network access (allowlist the Dokploy host IP).
3. Database name: `autonomous_os_kernel`.
4. Copy the SRV connection string → `MONGODB_URI` for every stateful service.
5. Collections are created on demand; indexes are created by services at startup
   (`serviceId`, `taskId`, `objectId`, event time/compound indexes).

Security: never commit `MONGODB_URI`. Rotate credentials periodically.
