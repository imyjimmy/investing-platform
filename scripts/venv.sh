#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_VENV_DIR="${VENV_DIR:-${PROJECT_ROOT}/.venv}"
DEFAULT_PYTHON_BIN="${PYTHON_BIN:-python3}"
DEFAULT_REQUIREMENTS_FILE="${REQUIREMENTS_FILE:-${PROJECT_ROOT}/requirements.txt}"


usage() {
  cat <<'EOF'
Usage:
  ./scripts/venv.sh create [venv_dir]
  ./scripts/venv.sh recreate [venv_dir]
  ./scripts/venv.sh install [venv_dir]
  ./scripts/venv.sh upgrade [venv_dir]
  ./scripts/venv.sh info [venv_dir]
  ./scripts/venv.sh python [venv_dir] -- [python args...]
  ./scripts/venv.sh pip [venv_dir] -- [pip args...]
  ./scripts/venv.sh run [venv_dir] -- <command...>
  ./scripts/venv.sh remove [venv_dir]
  ./scripts/venv.sh help

Environment variables:
  VENV_DIR           Default virtual environment path. Defaults to ./.venv
  PYTHON_BIN         Python interpreter used to create the venv. Defaults to python3
  REQUIREMENTS_FILE  Requirements file used by the install command. Defaults to ./requirements.txt
EOF
}


resolve_path() {
  local input_path="$1"
  if [[ "${input_path}" = /* ]]; then
    printf '%s\n' "${input_path}"
  else
    printf '%s\n' "${PROJECT_ROOT}/${input_path}"
  fi
}


ensure_requirements_file() {
  if [[ ! -f "${DEFAULT_REQUIREMENTS_FILE}" ]]; then
    echo "Requirements file not found: ${DEFAULT_REQUIREMENTS_FILE}" >&2
    exit 1
  fi
}


ensure_venv_exists() {
  local venv_dir="$1"
  if [[ ! -x "${venv_dir}/bin/python" ]]; then
    echo "Virtual environment not found at ${venv_dir}" >&2
    echo "Create it first with: ./scripts/venv.sh create ${venv_dir}" >&2
    exit 1
  fi
}


parse_venv_dir() {
  local maybe_dir="${1:-}"
  if [[ -z "${maybe_dir}" || "${maybe_dir}" = "--" ]]; then
    printf '%s\n' "${DEFAULT_VENV_DIR}"
  else
    resolve_path "${maybe_dir}"
  fi
}


upgrade_packaging_tools() {
  local venv_dir="$1"
  "${venv_dir}/bin/python" -m pip install --upgrade pip setuptools wheel
}


create_venv() {
  local venv_dir="$1"
  echo "Creating virtual environment at ${venv_dir}"
  "${DEFAULT_PYTHON_BIN}" -m venv "${venv_dir}"
}


install_requirements() {
  local venv_dir="$1"
  ensure_requirements_file
  ensure_venv_exists "${venv_dir}"
  echo "Installing dependencies from ${DEFAULT_REQUIREMENTS_FILE}"
  upgrade_packaging_tools "${venv_dir}"
  "${venv_dir}/bin/python" -m pip install -r "${DEFAULT_REQUIREMENTS_FILE}"
}


show_info() {
  local venv_dir="$1"
  echo "project_root=${PROJECT_ROOT}"
  echo "venv_dir=${venv_dir}"
  echo "python_bin=${DEFAULT_PYTHON_BIN}"
  echo "requirements_file=${DEFAULT_REQUIREMENTS_FILE}"
  if [[ -x "${venv_dir}/bin/python" ]]; then
    echo "status=present"
    echo "venv_python=$("${venv_dir}/bin/python" -c 'import sys; print(sys.executable)')"
    "${venv_dir}/bin/python" -V
    "${venv_dir}/bin/python" -m pip --version
  else
    echo "status=missing"
  fi
}


run_in_venv() {
  local venv_dir="$1"
  shift
  ensure_venv_exists "${venv_dir}"
  if [[ "$#" -eq 0 ]]; then
    echo "No command provided for run." >&2
    usage
    exit 1
  fi
  VIRTUAL_ENV="${venv_dir}" PATH="${venv_dir}/bin:${PATH}" "$@"
}


command_name="${1:-help}"
shift || true

case "${command_name}" in
  create)
    venv_dir="$(parse_venv_dir "${1:-}")"
    create_venv "${venv_dir}"
    ;;
  recreate)
    venv_dir="$(parse_venv_dir "${1:-}")"
    rm -rf "${venv_dir}"
    create_venv "${venv_dir}"
    ;;
  install)
    venv_dir="$(parse_venv_dir "${1:-}")"
    install_requirements "${venv_dir}"
    ;;
  upgrade)
    venv_dir="$(parse_venv_dir "${1:-}")"
    ensure_venv_exists "${venv_dir}"
    upgrade_packaging_tools "${venv_dir}"
    ;;
  info)
    venv_dir="$(parse_venv_dir "${1:-}")"
    show_info "${venv_dir}"
    ;;
  python)
    venv_dir="$(parse_venv_dir "${1:-}")"
    if [[ "${1:-}" != "--" && -n "${1:-}" ]]; then
      shift
    fi
    if [[ "${1:-}" = "--" ]]; then
      shift
    fi
    ensure_venv_exists "${venv_dir}"
    "${venv_dir}/bin/python" "$@"
    ;;
  pip)
    venv_dir="$(parse_venv_dir "${1:-}")"
    if [[ "${1:-}" != "--" && -n "${1:-}" ]]; then
      shift
    fi
    if [[ "${1:-}" = "--" ]]; then
      shift
    fi
    ensure_venv_exists "${venv_dir}"
    "${venv_dir}/bin/python" -m pip "$@"
    ;;
  run)
    venv_dir="$(parse_venv_dir "${1:-}")"
    if [[ "${1:-}" != "--" && -n "${1:-}" ]]; then
      shift
    fi
    if [[ "${1:-}" = "--" ]]; then
      shift
    fi
    run_in_venv "${venv_dir}" "$@"
    ;;
  remove)
    venv_dir="$(parse_venv_dir "${1:-}")"
    if [[ -d "${venv_dir}" ]]; then
      rm -rf "${venv_dir}"
      echo "Removed ${venv_dir}"
    else
      echo "Virtual environment not found at ${venv_dir}"
    fi
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: ${command_name}" >&2
    usage
    exit 1
    ;;
esac
