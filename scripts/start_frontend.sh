#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
HOST="${INVESTING_PLATFORM_FRONTEND_HOST:-${OPTIONS_DASHBOARD_FRONTEND_HOST:-127.0.0.1}}"
PORT="${INVESTING_PLATFORM_FRONTEND_PORT:-${OPTIONS_DASHBOARD_FRONTEND_PORT:-5173}}"

cd "${FRONTEND_DIR}"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run dev -- --host "${HOST}" --port "${PORT}"
