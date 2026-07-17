#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-}"
if [[ -z "${onboarding_path}" ]]; then
  echo "Usage: bash scripts/pilot_launch_from_onboarding.sh /absolute/path/to/pilot-onboarding.md" >&2
  exit 1
fi

output_root="${PILOT_REAL_LAUNCH_OUTPUT_DIR:-${repo_root}/tmp/pilot-real-launch}"
dry_run="${DRY_RUN:-0}"
auto_rollback_on_verify_fail="${AUTO_ROLLBACK_ON_VERIFY_FAIL:-0}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}"
logs_dir="${bundle_dir}/logs"
summary_path="${bundle_dir}/summary.txt"
status_path="${bundle_dir}/status.txt"
commands_path="${bundle_dir}/commands.txt"
handoff_path="${bundle_dir}/handoff.md"
validate_log="${logs_dir}/validate-onboarding.log"
prepare_log="${logs_dir}/prepare-from-onboarding.log"
readiness_log="${logs_dir}/check-launch-readiness.log"
create_log="${logs_dir}/apply-create.log"
verify_log="${logs_dir}/post-create-verify.log"
rollback_log="${logs_dir}/apply-rollback.log"

mkdir -p "${logs_dir}"
: > "${status_path}"
: > "${commands_path}"

record_status() {
  local line="$1"
  printf '%s\n' "${line}" >> "${status_path}"
}

record_command() {
  local line="$1"
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

  if "${command[@]}" > "${log_path}" 2>&1; then
    cat "${log_path}"
    record_status "${key}=ok"
    return 0
  fi

  cat "${log_path}"
  record_status "${key}=failed"
  return 1
}

extract_value() {
  local key="$1"
  local path="$2"
  sed -n "s/^${key}=//p" "${path}" | tail -n 1
}

candidate_profile=""
candidate_profile_path=""
creation_plan_path=""
create_sql_path=""
rollback_sql_path=""
create_bundle_path=""
verify_bundle_path=""
rollback_bundle_path=""
overall_decision="GO"

echo "Pilot real candidate launch"
echo "Onboarding path: ${onboarding_path}"
echo "Dry run: ${dry_run}"
echo "Auto rollback on verify fail: ${auto_rollback_on_verify_fail}"

if ! run_step "validate_onboarding" "Validate onboarding worksheet" "${validate_log}" env DRY_RUN="${dry_run}" bash "${script_dir}/pilot_validate_onboarding.sh" "${onboarding_path}"; then
  overall_decision="NO_GO"
fi

if [[ "${overall_decision}" == "GO" ]]; then
  if ! run_step "prepare" "Prepare candidate from onboarding" "${prepare_log}" env DRY_RUN="${dry_run}" bash "${script_dir}/pilot_prepare_from_onboarding.sh" "${onboarding_path}"; then
    overall_decision="NO_GO"
  else
    candidate_profile="$(extract_value "pilot_prepare_profile" "${prepare_log}")"
    candidate_profile_path="$(extract_value "pilot_prepare_profile_path" "${prepare_log}")"
    creation_plan_path="$(extract_value "pilot_prepare_creation_plan" "${prepare_log}")"
    create_sql_path="$(extract_value "pilot_prepare_create_sql" "${prepare_log}")"
    rollback_sql_path="$(extract_value "pilot_prepare_rollback_sql" "${prepare_log}")"
  fi
fi

if [[ "${overall_decision}" == "GO" ]]; then
  if ! run_step "launch_readiness" "Check prelaunch evidence and signoff" "${readiness_log}" env DRY_RUN="${dry_run}" bash "${script_dir}/pilot_check_launch_readiness.sh" "${onboarding_path}"; then
    overall_decision="NO_GO"
  fi
fi

if [[ "${overall_decision}" == "GO" ]]; then
  if ! run_step "apply_create" "Apply create SQL on hosted pilot lane" "${create_log}" env DRY_RUN="${dry_run}" PILOT_CANDIDATE_PROFILE="${candidate_profile}" bash "${script_dir}/pilot_apply_candidate_sql.sh" "${candidate_profile}" create; then
    overall_decision="NO_GO"
  else
    create_bundle_path="$(extract_value "pilot_sql_apply_bundle_path" "${create_log}")"
  fi
fi

if [[ "${overall_decision}" == "GO" ]]; then
  if ! run_step "post_create_verify" "Run hosted post-creation verification" "${verify_log}" env DRY_RUN="${dry_run}" PILOT_CANDIDATE_PROFILE="${candidate_profile}" bash "${script_dir}/pilot_post_creation_verify.sh" "${candidate_profile}"; then
    overall_decision="NO_GO"
    verify_bundle_path="$(extract_value "pilot_post_creation_bundle_path" "${verify_log}")"

    if [[ "${auto_rollback_on_verify_fail}" == "1" ]]; then
      if run_step "apply_rollback" "Apply rollback SQL after failed verification" "${rollback_log}" env DRY_RUN="${dry_run}" PILOT_CANDIDATE_PROFILE="${candidate_profile}" bash "${script_dir}/pilot_apply_candidate_sql.sh" "${candidate_profile}" rollback; then
        rollback_bundle_path="$(extract_value "pilot_sql_apply_bundle_path" "${rollback_log}")"
      else
        rollback_bundle_path="$(extract_value "pilot_sql_apply_bundle_path" "${rollback_log}")"
      fi
    fi
  else
    verify_bundle_path="$(extract_value "pilot_post_creation_bundle_path" "${verify_log}")"
  fi
fi

rollback_command=""
if [[ -n "${candidate_profile}" ]]; then
  rollback_command="PILOT_CANDIDATE_PROFILE=${candidate_profile} npm run pilot:apply-sql -- ${candidate_profile} rollback"
fi

{
  echo "pilot_real_launch_onboarding=${onboarding_path}"
  echo "pilot_real_launch_profile=${candidate_profile}"
  echo "pilot_real_launch_profile_path=${candidate_profile_path}"
  echo "pilot_real_launch_creation_plan=${creation_plan_path}"
  echo "pilot_real_launch_create_sql=${create_sql_path}"
  echo "pilot_real_launch_rollback_sql=${rollback_sql_path}"
  echo "pilot_real_launch_create_bundle=${create_bundle_path}"
  echo "pilot_real_launch_verify_bundle=${verify_bundle_path}"
  echo "pilot_real_launch_rollback_bundle=${rollback_bundle_path}"
  echo "pilot_real_launch_rollback_command=${rollback_command}"
  echo "pilot_real_launch_bundle_path=${bundle_dir}"
  echo "pilot_real_launch_handoff_path=${handoff_path}"
  echo "pilot_real_launch_decision=${overall_decision}"
  cat "${status_path}"
} > "${summary_path}"

{
  echo "# Pilot Real Candidate Launch"
  echo
  echo "- Onboarding path: \`${onboarding_path}\`"
  echo "- Candidate profile: \`${candidate_profile:-unknown}\`"
  echo "- Candidate profile path: \`${candidate_profile_path:-unknown}\`"
  echo "- Creation plan: \`${creation_plan_path:-unknown}\`"
  echo "- Create SQL: \`${create_sql_path:-unknown}\`"
  echo "- Rollback SQL: \`${rollback_sql_path:-unknown}\`"
  echo "- Create bundle: \`${create_bundle_path:-unknown}\`"
  echo "- Verify bundle: \`${verify_bundle_path:-unknown}\`"
  echo "- Rollback bundle: \`${rollback_bundle_path:-<not run>}\`"
  echo "- Rollback command: \`${rollback_command:-unknown}\`"
  echo "- Decision: \`${overall_decision}\`"
  echo
  echo "## Recorded Status"
  echo
  echo '```text'
  cat "${status_path}"
  echo '```'
} > "${handoff_path}"

echo "pilot_real_launch_onboarding=${onboarding_path}"
echo "pilot_real_launch_profile=${candidate_profile}"
echo "pilot_real_launch_profile_path=${candidate_profile_path}"
echo "pilot_real_launch_creation_plan=${creation_plan_path}"
echo "pilot_real_launch_create_sql=${create_sql_path}"
echo "pilot_real_launch_rollback_sql=${rollback_sql_path}"
echo "pilot_real_launch_create_bundle=${create_bundle_path}"
echo "pilot_real_launch_verify_bundle=${verify_bundle_path}"
echo "pilot_real_launch_rollback_bundle=${rollback_bundle_path}"
echo "pilot_real_launch_rollback_command=${rollback_command}"
echo "pilot_real_launch_bundle_path=${bundle_dir}"
echo "pilot_real_launch_handoff_path=${handoff_path}"
echo "pilot_real_launch_decision=${overall_decision}"

if [[ "${overall_decision}" != "GO" ]]; then
  exit 1
fi
