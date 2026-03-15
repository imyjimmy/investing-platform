#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_VENV_DIR="${VENV_DIR:-${PROJECT_ROOT}/.venv}"

if ! (return 0 2>/dev/null); then
  echo "This script must be sourced, not executed." >&2
  echo "Use: source scripts/activate.sh [venv_dir]" >&2
  exit 1
fi

TARGET_VENV="${1:-${DEFAULT_VENV_DIR}}"
if [[ "${TARGET_VENV}" != /* ]]; then
  TARGET_VENV="${PROJECT_ROOT}/${TARGET_VENV}"
fi

if [[ ! -f "${TARGET_VENV}/bin/activate" ]]; then
  echo "Virtual environment not found at ${TARGET_VENV}" >&2
  echo "Create it first with: ./scripts/venv.sh create ${TARGET_VENV}" >&2
  return 1
fi

# shellcheck disable=SC1090
. "${TARGET_VENV}/bin/activate"
echo "Activated virtual environment: ${TARGET_VENV}"
