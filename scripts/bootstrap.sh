#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR_ARG="${1:-${VENV_DIR:-${PROJECT_ROOT}/.venv}}"

"${SCRIPT_DIR}/venv.sh" create "${VENV_DIR_ARG}"
"${SCRIPT_DIR}/venv.sh" install "${VENV_DIR_ARG}"

cat <<EOF

Bootstrap complete.

Activate the environment with:
  source scripts/activate.sh ${VENV_DIR_ARG}

Or run commands without activating:
  ./scripts/venv.sh run ${VENV_DIR_ARG} -- python main.py --config configs/example_config.yaml
EOF
