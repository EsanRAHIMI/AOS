# Runbook: check-project-health

Verify the kernel compiles and core services are reachable.

## Build health
```bash
pnpm install
pnpm --filter @factory/shared run build
pnpm --filter @factory/service-kit run build
pnpm -r run typecheck
```

## Runtime health (after deploy)
```bash
for s in api registry events docs assets orchestrator architect builder devops memory; do
  curl -s https://$s.simorx.com/health || echo "DOWN: $s"
done
```
All should return `{ "status": "ok", "serviceId": "…" }`.

## Registry health
`curl -H "x-factory-internal-token: $TOKEN" https://registry.simorx.com/services`
