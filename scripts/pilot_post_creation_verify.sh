#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
source "${script_dir}/load_pilot_candidate_env.sh" "${PILOT_CANDIDATE_PROFILE:-${1:-}}"

pilot_profile="${PILOT_CANDIDATE_PROFILE_NAME:-${1:-}}"
if [[ -z "${pilot_profile}" ]]; then
  echo "Usage: bash scripts/pilot_post_creation_verify.sh <candidate-name-or-profile-path>" >&2
  exit 1
fi

output_root="${PILOT_POST_CREATION_OUTPUT_DIR:-${repo_root}/tmp/pilot-post-creation}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}-${pilot_profile}"
logs_dir="${bundle_dir}/logs"
summary_path="${bundle_dir}/summary.txt"
commands_path="${bundle_dir}/commands.txt"
handoff_path="${bundle_dir}/handoff.md"
status_path="${bundle_dir}/status.txt"
audit_log="${logs_dir}/audit.log"
vps_log="${logs_dir}/vps.log"
dry_run="${DRY_RUN:-0}"

mkdir -p "${logs_dir}"

status_lines=()
command_lines=()

record_status() {
  local line="$1"
  status_lines+=("${line}")
  printf '%s\n' "${line}" >> "${status_path}"
}

record_command() {
  local line="$1"
  command_lines+=("${line}")
  printf '%s\n' "${line}" >> "${commands_path}"
}

run_step() {
  local key="$1"
  local label="$2"
  local log_path="$3"
  shift 3
  local command=("$@")

  echo
  echo "==> ${label}"
  printf '%q ' "${command[@]}" | sed 's/ $//'
  echo
  record_command "$(printf '%q ' "${command[@]}" | sed 's/ $//')"

  if [[ "${dry_run}" == "1" ]]; then
    printf 'DRY_RUN %s\n' "$(printf '%q ' "${command[@]}" | sed 's/ $//')" | tee "${log_path}"
    record_status "${key}=skipped"
    return 0
  fi

  if "${command[@]}" > "${log_path}" 2>&1; then
    cat "${log_path}"
    record_status "${key}=ok"
    return 0
  fi

  cat "${log_path}"
  record_status "${key}=failed"
  return 1
}

: > "${status_path}"
: > "${commands_path}"

overall_decision="GO"

echo "Pilot post-creation verification"
echo "Pilot candidate profile: ${pilot_profile}"
echo "Pilot organization: ${PILOT_ORGANIZATION_SLUG:-unknown}"
echo "Pilot club: ${PILOT_CLUB_SLUG:-${CLUB_SLUG:-unknown}}"

if ! run_step "audit" "Run hosted audit" "${audit_log}" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" npm run pilot:audit; then
  overall_decision="NO_GO"
  printf '%s\n' "Hosted audit failed; VPS scenarios were not attempted." > "${vps_log}"
  record_status "vps=blocked audit"
else
  if ! run_step "vps" "Run hosted VPS scenarios" "${vps_log}" env PILOT_CANDIDATE_PROFILE="${pilot_profile}" npm run pilot:vps; then
    overall_decision="NO_GO"
  fi
fi

{
  echo "pilot_post_creation_profile=${pilot_profile}"
  echo "pilot_post_creation_profile_path=${PILOT_CANDIDATE_PROFILE_PATH:-unknown}"
  echo "pilot_post_creation_bundle_path=${bundle_dir}"
  echo "pilot_post_creation_summary_path=${summary_path}"
  echo "pilot_post_creation_handoff_path=${handoff_path}"
  echo "pilot_post_creation_audit_log=${audit_log}"
  echo "pilot_post_creation_vps_log=${vps_log}"
  echo "pilot_post_creation_decision=${overall_decision}"
  cat "${status_path}"
} > "${summary_path}"

{
  echo "# Pilot Post-Creation Verification"
  echo
  echo "- Candidate profile: \`${pilot_profile}\`"
  echo "- Candidate profile path: \`${PILOT_CANDIDATE_PROFILE_PATH:-unknown}\`"
  echo "- Decision: \`${overall_decision}\`"
  echo "- Audit log: \`${audit_log}\`"
  echo "- VPS log: \`${vps_log}\`"
  echo "- Commands: \`${commands_path}\`"
  echo "- Status file: \`${status_path}\`"
  echo
  echo "## Required Hosted Gates"
  echo
  echo "1. Hosted audit must pass before scenario verification."
  echo "2. Hosted VPS scenarios must pass immediately after a successful audit."
  echo "3. If audit fails, do not continue to more hosted checks before rollback review."
  echo
  echo "## Recorded Status"
  echo
  echo '```text'
  cat "${status_path}"
  echo '```'
} > "${handoff_path}"

echo "pilot_post_creation_profile=${pilot_profile}"
echo "pilot_post_creation_profile_path=${PILOT_CANDIDATE_PROFILE_PATH:-unknown}"
echo "pilot_post_creation_bundle_path=${bundle_dir}"
echo "pilot_post_creation_summary_path=${summary_path}"
echo "pilot_post_creation_handoff_path=${handoff_path}"
echo "pilot_post_creation_audit_log=${audit_log}"
echo "pilot_post_creation_vps_log=${vps_log}"
echo "pilot_post_creation_decision=${overall_decision}"

if [[ "${overall_decision}" != "GO" ]]; then
  exit 1
fi
