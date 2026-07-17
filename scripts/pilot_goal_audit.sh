#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-}"
reply_template_path="${2:-}"

if [[ -z "${onboarding_path}" || -z "${reply_template_path}" ]]; then
  echo "Usage: bash scripts/pilot_goal_audit.sh /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt" >&2
  exit 1
fi

if [[ ! -f "${onboarding_path}" ]]; then
  echo "Missing onboarding worksheet: ${onboarding_path}" >&2
  exit 1
fi

if [[ ! -f "${reply_template_path}" ]]; then
  echo "Missing reply template: ${reply_template_path}" >&2
  exit 1
fi

output_root="${PILOT_GOAL_AUDIT_OUTPUT_DIR:-${repo_root}/tmp/pilot-goal-audit}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}"
logs_dir="${bundle_dir}/logs"
summary_path="${bundle_dir}/summary.txt"
report_path="${bundle_dir}/goal-audit.md"
preflight_log="${logs_dir}/preflight-from-reply-template.log"

mkdir -p "${logs_dir}"

run_capture() {
  local log_path="$1"
  shift
  set +e
  "$@" > "${log_path}" 2>&1
  local status=$?
  set -e
  cat "${log_path}"
  return "${status}"
}

extract_value() {
  local key="$1"
  local path="$2"
  if [[ ! -f "${path}" ]]; then
    return 0
  fi
  sed -n "s/^${key}=//p" "${path}" | tail -n 1
}

preflight_status=0
run_capture "${preflight_log}" bash "${script_dir}/pilot_preflight_from_reply_template.sh" "${onboarding_path}" "${reply_template_path}" || preflight_status=$?

candidate_profile="$(extract_value "pilot_reply_template_preflight_candidate_profile" "${preflight_log}")"
candidate_profile_path="$(extract_value "pilot_reply_template_preflight_candidate_profile_path" "${preflight_log}")"
create_sql_path="$(extract_value "pilot_reply_template_preflight_create_sql" "${preflight_log}")"
rollback_sql_path="$(extract_value "pilot_reply_template_preflight_rollback_sql" "${preflight_log}")"
profile_preflight="$(extract_value "pilot_reply_template_preflight_profile_preflight" "${preflight_log}")"
readiness_result="$(extract_value "pilot_reply_template_preflight_readiness" "${preflight_log}")"

objective_decision="NO_GO"
real_data_status="missing"
record_creation_status="pending"
hosted_verification_status="pending"
rollback_status="partial"
next_step="provide_real_candidate_inputs"

if [[ "${preflight_status}" -eq 0 ]]; then
  real_data_status="ready"
  rollback_status="ready_locally"
  if [[ "${profile_preflight}" == "ok" && "${readiness_result}" == "GO" ]]; then
    next_step="run_hosted_create_and_verification"
  fi
fi

if [[ -n "${candidate_profile}" && -n "${candidate_profile_path}" ]]; then
  record_creation_status="not_yet_run"
fi

if [[ "${record_creation_status}" == "created" && "${hosted_verification_status}" == "verified" ]]; then
  objective_decision="GO"
fi

{
  echo "pilot_goal_audit_onboarding=${onboarding_path}"
  echo "pilot_goal_audit_reply_template=${reply_template_path}"
  echo "pilot_goal_audit_bundle=${bundle_dir}"
  echo "pilot_goal_audit_candidate_profile=${candidate_profile}"
  echo "pilot_goal_audit_candidate_profile_path=${candidate_profile_path}"
  echo "pilot_goal_audit_create_sql=${create_sql_path}"
  echo "pilot_goal_audit_rollback_sql=${rollback_sql_path}"
  echo "pilot_goal_audit_real_data_status=${real_data_status}"
  echo "pilot_goal_audit_record_creation_status=${record_creation_status}"
  echo "pilot_goal_audit_hosted_verification_status=${hosted_verification_status}"
  echo "pilot_goal_audit_rollback_status=${rollback_status}"
  echo "pilot_goal_audit_next_step=${next_step}"
  echo "pilot_goal_audit_decision=${objective_decision}"
} > "${summary_path}"

{
  echo "# Pilot Goal Audit"
  echo
  echo "Objective: create the first real pilot candidate in a controlled way by applying the validated onboarding packet, creating the organization and role records with clear ownership, running hosted audit and scenario verification against the new candidate, and proving rollback readiness before any live club use."
  echo
  echo "## Current Evidence"
  echo
  echo "- Onboarding worksheet: \`${onboarding_path}\`"
  echo "- Reply template: \`${reply_template_path}\`"
  echo "- Candidate profile: \`${candidate_profile:-unknown}\`"
  echo "- Candidate profile path: \`${candidate_profile_path:-unknown}\`"
  echo "- Create SQL: \`${create_sql_path:-unknown}\`"
  echo "- Rollback SQL: \`${rollback_sql_path:-unknown}\`"
  echo
  echo "## Requirement Audit"
  echo
  echo "1. Apply the validated onboarding packet: \`${real_data_status}\`"
  echo "2. Create the organization and role records with clear ownership: \`${record_creation_status}\`"
  echo "3. Run hosted audit and scenario verification against the new candidate: \`${hosted_verification_status}\`"
  echo "4. Prove rollback readiness before live club use: \`${rollback_status}\`"
  echo
  echo "## Decision"
  echo
  echo "- Overall decision: \`${objective_decision}\`"
  echo "- Next step: \`${next_step}\`"
  echo
  echo "## Notes"
  echo
  echo "- A local preflight pass proves the onboarding packet, candidate profile, create SQL, and rollback SQL are ready."
  echo "- This audit does not mark hosted creation or hosted verification complete unless those steps have actually been run and saved."
  echo "- Until real hosted creation and hosted verification are executed, the full objective remains incomplete."
} > "${report_path}"

cat "${summary_path}"

if [[ "${objective_decision}" != "GO" ]]; then
  exit 1
fi
