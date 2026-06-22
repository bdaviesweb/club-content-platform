#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
DRY_RUN="${DRY_RUN:-0}"
runtime_root="${PILOT_DEMO_RUNTIME_ROOT:-${HOME}/.club-content-pilot-runtime}"
runtime_state_root="${PILOT_DEMO_RUNTIME_STATE_ROOT:-${runtime_root}/state}"
bundle_root="${PILOT_DEMO_BUNDLE_ROOT:-${repo_root}/tmp/pilot-demo}"

log() {
  printf '%s\n' "$1"
}

run_cmd() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "DRY_RUN $*"
    return 0
  fi

  "$@"
}

log "pilot_demo_runtime_root=${runtime_root}"
log "pilot_demo_runtime_state_root=${runtime_state_root}"
log "pilot_demo_bundle_root=${bundle_root}"

PILOT_DEMO_RUNTIME_ROOT="${runtime_root}" \
PILOT_DEMO_RUNTIME_STATE_ROOT="${runtime_state_root}" \
PILOT_DEMO_BUNDLE_ROOT="${bundle_root}" \
PILOT_DEMO_BUNDLE_RUNTIME_ROOT="${bundle_root}/runtime" \
DRY_RUN="${DRY_RUN}" \
  bash "${script_dir}/stop_pilot_demo_runtime.sh"

run_cmd rm -rf "${runtime_state_root}"

if [[ -d "${bundle_root}" ]]; then
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "DRY_RUN find ${bundle_root} -mindepth 1 -maxdepth 1 -type d ! -name runtime -exec rm -rf {} +"
  else
    find "${bundle_root}" -mindepth 1 -maxdepth 1 -type d ! -name runtime -exec rm -rf {} +
    log "bundles=cleared"
  fi
else
  log "bundles=missing"
fi
