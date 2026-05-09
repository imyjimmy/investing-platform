#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
PORTS_FILE="${INVESTING_PLATFORM_DEV_PORTS_FILE:-${PROJECT_ROOT}/configs/dev_ports.env}"

if [[ -f "${PORTS_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${PORTS_FILE}"
  set +a
fi

export INVESTING_PLATFORM_FRONTEND_PORT="${INVESTING_PLATFORM_FRONTEND_PORT:-5173}"
export INVESTING_PLATFORM_BACKEND_PORT="${INVESTING_PLATFORM_BACKEND_PORT:-8000}"
export OMLX_PORT="${OMLX_PORT:-8001}"

validate_port() {
  local name="$1"
  local value="$2"
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "${name} must be a TCP port between 1 and 65535; got '${value}' from ${PORTS_FILE}." >&2
    exit 1
  fi
}

validate_port "INVESTING_PLATFORM_FRONTEND_PORT" "${INVESTING_PLATFORM_FRONTEND_PORT}"
validate_port "INVESTING_PLATFORM_BACKEND_PORT" "${INVESTING_PLATFORM_BACKEND_PORT}"
validate_port "OMLX_PORT" "${OMLX_PORT}"

cd "${FRONTEND_DIR}"

if [[ ! -d node_modules ]]; then
  npm install
fi

TAURI_DEV_CONFIG="$(printf '{"build":{"devUrl":"http://127.0.0.1:%s","beforeDevCommand":"cd .. && ./scripts/dev_dashboard.sh"}}' "${INVESTING_PLATFORM_FRONTEND_PORT}")"

./node_modules/.bin/tauri dev --config "${TAURI_DEV_CONFIG}"
