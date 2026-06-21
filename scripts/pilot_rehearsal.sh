#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

pilot_profile="${1:-${PILOT_CANDIDATE_PROFILE:-simulated-north-river}}"
DRY_RUN="${DRY_RUN:-0}"

source "${script_dir}/load_pilot_candidate_env.sh" "${pilot_profile}"

run_step() {
  local label="$1"
  shift

  echo "==> ${label}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    printf 'DRY_RUN'
    for arg in "$@"; do
      printf ' %q' "${arg}"
    done
    printf '\n'
    return 0
  fi

  "$@"
}

echo "pilot_rehearsal_profile=${PILOT_CANDIDATE_PROFILE:-${pilot_profile}}"
if [[ -n "${PILOT_CANDIDATE_PROFILE_PATH:-}" ]]; then
  echo "pilot_rehearsal_profile_path=${PILOT_CANDIDATE_PROFILE_PATH}"
fi

run_step "Inspect simulator profile" npm run pilot:inspect -- "${pilot_profile}"
run_step "Validate simulator profile" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" bash scripts/validate_pilot_candidate_profile.sh
run_step "Run backend audit" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" npm run pilot:audit
run_step "Run VPS rehearsal" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" npm run pilot:vps
run_step "Verify demo UI contract" node --test "${repo_root}/apps/admin-web/server.test.js"

echo "pilot_rehearsal_result=ok"
