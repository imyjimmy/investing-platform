#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MODEL_ID="${1:-mlx-community/Qwen3.6-35B-A3B-4bit}"
MODEL_DIR="${MODEL_DIR:-${HOME}/models/${MODEL_ID}}"

cd "${PROJECT_ROOT}"

./scripts/venv.sh run -- hf download "${MODEL_ID}" --local-dir "${MODEL_DIR}"
