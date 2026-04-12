#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${VENV_DIR:-${PROJECT_ROOT}/.venv}"
HOST="${INVESTING_PLATFORM_BACKEND_HOST:-${OPTIONS_DASHBOARD_BACKEND_HOST:-127.0.0.1}}"
PORT="${INVESTING_PLATFORM_BACKEND_PORT:-${OPTIONS_DASHBOARD_BACKEND_PORT:-8000}}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Virtual environment not found at ${VENV_DIR}" >&2
  echo "Run ./scripts/bootstrap.sh first." >&2
  exit 1
fi

cd "${PROJECT_ROOT}"
PYTHONPATH="${PROJECT_ROOT}/src${PYTHONPATH:+:${PYTHONPATH}}" \
  ./scripts/venv.sh run "${VENV_DIR}" -- uvicorn investing_platform.main:app --reload --host "${HOST}" --port "${PORT}"
