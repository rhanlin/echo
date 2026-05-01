#!/usr/bin/env bash
# Local dev runner for the echo server.
#
# Override any of the documented env vars before invocation, e.g.:
#   SERVER_PORT=5555 ./apps/server/scripts/run.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."

export SERVER_PORT="${SERVER_PORT:-4000}"
export DB_PATH="${DB_PATH:-./events.db}"
export CORS_ORIGINS="${CORS_ORIGINS:-*}"
export WS_SNAPSHOT_LIMIT="${WS_SNAPSHOT_LIMIT:-300}"

exec bun run apps/server/src/index.ts
