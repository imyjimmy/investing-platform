#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OMLX_AUTOSTART="${INVESTING_PLATFORM_AUTOSTART_OMLX:-1}"
OMLX_PORT="${OMLX_PORT:-8001}"
VENV_DIR="${VENV_DIR:-${PROJECT_ROOT}/.venv}"

cleanup() {
  if [[ -n "${OMLX_PID:-}" ]]; then
    kill "${OMLX_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "${PROJECT_ROOT}"

is_truthy() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "${normalized}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

port_is_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local port="$1"
  local timeout_seconds="${2:-30}"
  local elapsed=0
  while (( elapsed < timeout_seconds )); do
    if port_is_listening "${port}"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

start_omlx_dependency() {
  if ! is_truthy "${OMLX_AUTOSTART}"; then
    echo "Skipping oMLX autostart because INVESTING_PLATFORM_AUTOSTART_OMLX=${OMLX_AUTOSTART}."
    return 0
  fi

  if port_is_listening "${OMLX_PORT}"; then
    echo "oMLX appears to already be listening on 127.0.0.1:${OMLX_PORT}."
    return 0
  fi

  if [[ ! -x "${VENV_DIR}/bin/omlx" ]]; then
    echo "oMLX is not installed in ${VENV_DIR}; Qwen readiness will show unavailable until it is installed." >&2
    echo "Install with: ./scripts/install_omlx.sh && ./scripts/download_qwen_model.sh" >&2
    return 0
  fi

  echo "Starting oMLX on 127.0.0.1:${OMLX_PORT}..."
  ./scripts/start_omlx.sh &
  OMLX_PID=$!
  if wait_for_port "${OMLX_PORT}" "${OMLX_STARTUP_TIMEOUT_SECONDS:-45}"; then
    echo "oMLX is listening on 127.0.0.1:${OMLX_PORT}."
  else
    echo "oMLX did not begin listening on 127.0.0.1:${OMLX_PORT} within the startup timeout." >&2
    echo "The dashboard will still start; check oMLX logs above if Qwen remains unavailable." >&2
  fi
}

start_omlx_dependency

./scripts/start_backend.sh &
BACKEND_PID=$!

./scripts/start_frontend.sh &
FRONTEND_PID=$!

wait "${BACKEND_PID}" "${FRONTEND_PID}"
