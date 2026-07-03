#!/usr/bin/env bash
# Build the Dokploy target service (SERVICE_ID from Environment Settings).
set -euo pipefail

SERVICE_ID="${SERVICE_ID:?Missing SERVICE_ID — set it in Dokploy Environment Settings}"

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

pnpm --filter "${PKG}..." run build
