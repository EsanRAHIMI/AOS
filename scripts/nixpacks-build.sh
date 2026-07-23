#!/usr/bin/env bash
# Build the Dokploy target service (SERVICE_ID from Environment Settings).
set -euo pipefail

SERVICE_ID="${SERVICE_ID:-}"
if [[ -z "$SERVICE_ID" ]]; then
  echo "nixpacks-build: Missing SERVICE_ID during build."
  echo "Dokploy Env is runtime-only. Use Build Type=Dockerfile with:"
  echo "  deployment/docker/Dockerfile.<service-id>"
  echo "  e.g. deployment/docker/Dockerfile.aos-agent-runtime"
  echo "Or set Docker Build Arg SERVICE_ID=<id>."
  exit 1
fi

VALID_IDS=(
  service-registry
  event-bus-service
  gateway-api
  orchestrator-agent
  architect-agent
  builder-agent
  devops-agent
  reviewer-agent
  qa-agent
  memory-agent
  documentation-service
  file-asset-service
  monitor-agent
  report-agent
  internet-research-service
  browser-testing-agent
  voice-operator-agent
  code-operator-agent
  dashboard-web
  aos-agent-runtime
)

ok=0
for id in "${VALID_IDS[@]}"; do
  if [[ "$id" == "$SERVICE_ID" ]]; then
    ok=1
    break
  fi
done

if [[ "$ok" -ne 1 ]]; then
  echo "nixpacks-build: unknown SERVICE_ID=$SERVICE_ID"
  echo "Allowed: ${VALID_IDS[*]}"
  exit 1
fi

PKG="@factory/${SERVICE_ID}"
echo "nixpacks-build: SERVICE_ID=$SERVICE_ID package=$PKG"

export NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}"
# Prevent OOM kills on small Dokploy build VMs (Next.js + TypeScript)
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

pnpm --filter "${PKG}..." run build

echo "nixpacks-build: OK — ${PKG}"
