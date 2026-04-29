#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OMLX_MODEL_DIR="${OMLX_MODEL_DIR:-${HOME}/models/mlx-community}"
OMLX_PORT="${OMLX_PORT:-8001}"

cd "${PROJECT_ROOT}"

./scripts/venv.sh run -- omlx serve --model-dir "${OMLX_MODEL_DIR}" --port "${OMLX_PORT}"
