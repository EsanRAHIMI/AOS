# Runbook: validate-env

Each service validates env at startup via `shared/src/env` (Zod). To check
before deploy:

```bash
# dry-run: load env and print parsed result without starting the server
node -e "import('@factory/shared').then(m => { \
  const e = m.loadEnv(m.BaseEnvSchema.merge(m.MongoEnvSchema), process.env); \
  console.log('env ok for', e.SERVICE_ID); })"
```

Missing/invalid values fail fast with a readable message listing each problem.
