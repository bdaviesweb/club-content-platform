#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

pilot_profile="${1:-${PILOT_CANDIDATE_PROFILE:-simulated-north-river}}"
DRY_RUN="${DRY_RUN:-0}"
rehearsal_output_dir="${PILOT_REHEARSAL_OUTPUT_DIR:-${repo_root}/tmp/pilot-rehearsal}"

source "${script_dir}/load_pilot_candidate_env.sh" "${pilot_profile}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
profile_slug="${pilot_profile//[^a-zA-Z0-9._-]/-}"
if [[ -z "${profile_slug}" ]]; then
  profile_slug="profile"
fi

bundle_name="${timestamp}-${profile_slug}"
bundle_dir="${rehearsal_output_dir}/${bundle_name}"
logs_dir="${bundle_dir}/logs"
mkdir -p "${logs_dir}"

summary_file="${bundle_dir}/summary.txt"
status_file="${bundle_dir}/status.txt"
commands_file="${bundle_dir}/commands.txt"

: >"${summary_file}"
: >"${status_file}"
: >"${commands_file}"

log_line() {
  printf '%s\n' "$1" | tee -a "${summary_file}"
}

record_status() {
  printf '%s\n' "$1" >> "${status_file}"
}

record_command() {
  printf '%s\n' "$1" >> "${commands_file}"
}

run_step() {
  local step_key="$1"
  local label="$2"
  local output_file="$3"
  shift 3

  log_line "==> ${label}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    command_line="DRY_RUN"
    for arg in "$@"; do
      command_line+=" $(printf '%q' "${arg}")"
    done
    log_line "${command_line}"
    printf '%s\n' "${command_line}" > "${output_file}"
    record_command "${command_line}"
    record_status "${step_key}=skipped"
    log_line "${step_key}=skipped"
    return 0
  fi

  command_line=""
  for arg in "$@"; do
    command_line+=" $(printf '%q' "${arg}")"
  done
  command_line="${command_line# }"
  record_command "${command_line}"
  if "$@" >"${output_file}" 2>&1; then
    record_status "${step_key}=ok"
    log_line "${step_key}=ok"
    return 0
  fi

  local exit_code=$?
  record_status "${step_key}=failed exit_code=${exit_code}"
  log_line "${step_key}=failed exit_code=${exit_code}"
  return "${exit_code}"
}

inspect_output="${logs_dir}/inspect.log"
validate_output="${logs_dir}/validate.log"
audit_output="${logs_dir}/audit.log"
vps_output="${logs_dir}/vps.log"
ui_output="${logs_dir}/demo-ui.log"

log_line "pilot_rehearsal_profile=${PILOT_CANDIDATE_PROFILE:-${pilot_profile}}"
log_line "pilot_rehearsal_profile_path=${PILOT_CANDIDATE_PROFILE_PATH:-<unset>}"
log_line "pilot_rehearsal_bundle_path=${bundle_dir}"
log_line "pilot_rehearsal_summary_path=${summary_file}"

overall_status=0

if ! run_step "inspect" "Inspect simulator profile" "${inspect_output}" npm run pilot:inspect -- "${pilot_profile}"; then
  overall_status=1
fi

if ! run_step "validate" "Validate simulator profile" "${validate_output}" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" bash scripts/validate_pilot_candidate_profile.sh; then
  overall_status=1
fi

if ! run_step "audit" "Run backend audit" "${audit_output}" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" npm run pilot:audit; then
  overall_status=1
fi

if ! run_step "vps" "Run VPS rehearsal" "${vps_output}" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" npm run pilot:vps; then
  overall_status=1
fi

if ! run_step "ui" "Verify demo UI contract" "${ui_output}" node --test "${repo_root}/apps/admin-web/server.test.js"; then
  overall_status=1
fi

audit_blockers=()
if [[ -f "${audit_output}" ]]; then
  while IFS= read -r blocker_line; do
    [[ -n "${blocker_line}" ]] || continue
    audit_blockers+=("${blocker_line#blocker=}")
  done < <(grep '^blocker=' "${audit_output}" || true)
fi

if [[ "${overall_status}" -eq 0 ]]; then
  decision="GO"
else
  decision="NO_GO"
fi

{
  echo "pilot_rehearsal_decision=${decision}"
  echo "pilot_rehearsal_step_results="
  cat "${status_file}"
  if [[ "${#audit_blockers[@]}" -gt 0 ]]; then
    echo "pilot_rehearsal_audit_blockers="
    for blocker in "${audit_blockers[@]}"; do
      echo "blocker=${blocker}"
    done
  fi
} >> "${summary_file}"

log_line "pilot_rehearsal_decision=${decision}"
if [[ "${#audit_blockers[@]}" -gt 0 ]]; then
  log_line "pilot_rehearsal_audit_blockers=${#audit_blockers[@]}"
fi

if [[ "${decision}" == "NO_GO" ]]; then
  if [[ "${#audit_blockers[@]}" -gt 0 ]]; then
    for blocker in "${audit_blockers[@]}"; do
      log_line "blocker=${blocker}"
    done
  fi
  exit 1
fi

echo "pilot_rehearsal_result=ok"
