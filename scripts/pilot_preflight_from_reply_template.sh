#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-}"
reply_template_path="${2:-}"

if [[ -z "${onboarding_path}" || -z "${reply_template_path}" ]]; then
  echo "Usage: bash scripts/pilot_preflight_from_reply_template.sh /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt" >&2
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

output_root="${PILOT_REPLY_TEMPLATE_PREFLIGHT_OUTPUT_DIR:-${repo_root}/tmp/pilot-reply-template-preflight}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}"
logs_dir="${bundle_dir}/logs"
summary_path="${bundle_dir}/summary.txt"
readme_path="${bundle_dir}/README.md"
prepare_log="${logs_dir}/prepare-from-reply-template.log"
inspect_log="${logs_dir}/inspect-profile.log"
validate_log="${logs_dir}/validate-profile.log"

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

prepare_status=0
inspect_status=0
validate_status=0

run_capture "${prepare_log}" bash "${script_dir}/pilot_prepare_from_reply_template.sh" "${onboarding_path}" "${reply_template_path}" || prepare_status=$?

candidate_profile="$(extract_value "pilot_reply_template_prep_candidate_profile" "${prepare_log}")"
candidate_profile_path="$(extract_value "pilot_reply_template_prep_candidate_profile_path" "${prepare_log}")"
creation_plan_path="$(extract_value "pilot_reply_template_prep_creation_plan" "${prepare_log}")"
create_sql_path="$(extract_value "pilot_reply_template_prep_create_sql" "${prepare_log}")"
rollback_sql_path="$(extract_value "pilot_reply_template_prep_rollback_sql" "${prepare_log}")"
readiness_result="$(extract_value "pilot_reply_template_prep_readiness" "${prepare_log}")"
prep_bundle_path="$(extract_value "pilot_reply_template_prep_bundle" "${prepare_log}")"

if [[ "${prepare_status}" -eq 0 && -n "${candidate_profile}" ]]; then
  run_capture "${inspect_log}" bash "${script_dir}/inspect_pilot_candidate_profile.sh" "${candidate_profile}" || inspect_status=$?
  run_capture "${validate_log}" env PILOT_CANDIDATE_PROFILE="${candidate_profile}" bash "${script_dir}/validate_pilot_candidate_profile.sh" "${candidate_profile}" || validate_status=$?
fi

overall_decision="GO"
next_step="review_summary_bundle"
if [[ "${prepare_status}" -ne 0 || "${inspect_status}" -ne 0 || "${validate_status}" -ne 0 ]]; then
  overall_decision="NO_GO"
else
  next_step="hosted_create_with_operator_present"
fi

profile_preflight_result="$(extract_value "preflight_result" "${validate_log}")"

{
  echo "pilot_reply_template_preflight_onboarding=${onboarding_path}"
  echo "pilot_reply_template_preflight_reply_template=${reply_template_path}"
  echo "pilot_reply_template_preflight_prep_bundle=${prep_bundle_path}"
  echo "pilot_reply_template_preflight_bundle=${bundle_dir}"
  echo "pilot_reply_template_preflight_candidate_profile=${candidate_profile}"
  echo "pilot_reply_template_preflight_candidate_profile_path=${candidate_profile_path}"
  echo "pilot_reply_template_preflight_creation_plan=${creation_plan_path}"
  echo "pilot_reply_template_preflight_create_sql=${create_sql_path}"
  echo "pilot_reply_template_preflight_rollback_sql=${rollback_sql_path}"
  echo "pilot_reply_template_preflight_readiness=${readiness_result:-NO_GO}"
  echo "pilot_reply_template_preflight_profile_preflight=${profile_preflight_result:-failed}"
  echo "pilot_reply_template_preflight_next_step=${next_step}"
  echo "pilot_reply_template_preflight_decision=${overall_decision}"
} > "${summary_path}"

{
  echo "# Reply Template Preflight"
  echo
  echo "- Source onboarding worksheet: \`${onboarding_path}\`"
  echo "- Reply template: \`${reply_template_path}\`"
  echo "- Prep bundle: \`${prep_bundle_path:-unknown}\`"
  echo "- Candidate profile: \`${candidate_profile:-unknown}\`"
  echo "- Candidate profile path: \`${candidate_profile_path:-unknown}\`"
  echo "- Creation plan: \`${creation_plan_path:-unknown}\`"
  echo "- Create SQL: \`${create_sql_path:-unknown}\`"
  echo "- Rollback SQL: \`${rollback_sql_path:-unknown}\`"
  echo "- Local readiness result: \`${readiness_result:-NO_GO}\`"
  echo "- Profile preflight result: \`${profile_preflight_result:-failed}\`"
  echo "- Decision: \`${overall_decision}\`"
  if [[ "${overall_decision}" == "GO" ]]; then
    echo "- Next step: hosted create with operator present using \`${candidate_profile}\`"
  else
    echo "- Next step: review the logs in \`${logs_dir}\` and resolve the local candidate issues before attempting hosted creation."
  fi
  echo
  echo "## Logs"
  echo
  echo "- Prepare log: \`${prepare_log}\`"
  echo "- Inspect log: \`${inspect_log}\`"
  echo "- Validate log: \`${validate_log}\`"
} > "${readme_path}"

cat "${summary_path}"

if [[ "${overall_decision}" != "GO" ]]; then
  exit 1
fi
