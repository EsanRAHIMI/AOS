#!/usr/bin/env bash
# Start the Dokploy target service (SERVICE_ID from Environment Settings).
set -euo pipefail

SERVICE_ID="${SERVICE_ID:?Missing SERVICE_ID — set it in Dokploy Environment Settings}"
PKG="@factory/${SERVICE_ID}"

echo "nixpacks-start: SERVICE_ID=$SERVICE_ID package=$PKG port=${SERVICE_PORT:-?}"

exec pnpm --filter "$PKG" run start
