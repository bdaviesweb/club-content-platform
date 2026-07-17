#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-}"
reply_template_path="${2:-}"

if [[ -z "${onboarding_path}" || -z "${reply_template_path}" ]]; then
  echo "Usage: bash scripts/pilot_prepare_from_reply_template.sh /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt" >&2
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

output_root="${PILOT_REPLY_TEMPLATE_PREP_OUTPUT_DIR:-${repo_root}/tmp/pilot-reply-template-prep}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}"
logs_dir="${bundle_dir}/logs"
summary_path="${bundle_dir}/summary.txt"
readme_path="${bundle_dir}/README.md"
process_log="${logs_dir}/process-reply-template.log"
prepare_log="${logs_dir}/prepare-from-onboarding.log"

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

process_status=0
prepare_status=0

run_capture "${process_log}" bash "${script_dir}/pilot_process_reply_template.sh" "${onboarding_path}" "${reply_template_path}" || process_status=$?

applied_onboarding_path="$(extract_value "pilot_reply_template_process_applied_onboarding" "${process_log}")"
process_bundle_path="$(extract_value "pilot_reply_template_process_bundle" "${process_log}")"

if [[ "${process_status}" -eq 0 ]]; then
  run_capture "${prepare_log}" bash "${script_dir}/pilot_prepare_from_onboarding.sh" "${applied_onboarding_path}" || prepare_status=$?
fi

candidate_profile="$(extract_value "pilot_prepare_profile" "${prepare_log}")"
candidate_profile_path="$(extract_value "pilot_prepare_profile_path" "${prepare_log}")"
creation_plan_path="$(extract_value "pilot_prepare_creation_plan" "${prepare_log}")"
create_sql_path="$(extract_value "pilot_prepare_create_sql" "${prepare_log}")"
rollback_sql_path="$(extract_value "pilot_prepare_rollback_sql" "${prepare_log}")"
intake_path="$(extract_value "pilot_prepare_onboarding_intake" "${prepare_log}")"
readiness_result="$(extract_value "pilot_prepare_readiness" "${prepare_log}")"

overall_decision="GO"
next_step="review_summary_bundle"
if [[ "${process_status}" -ne 0 || "${prepare_status}" -ne 0 ]]; then
  overall_decision="NO_GO"
else
  next_step="inspect_candidate_profile"
fi

{
  echo "pilot_reply_template_prep_onboarding=${onboarding_path}"
  echo "pilot_reply_template_prep_reply_template=${reply_template_path}"
  echo "pilot_reply_template_prep_process_bundle=${process_bundle_path}"
  echo "pilot_reply_template_prep_applied_onboarding=${applied_onboarding_path}"
  echo "pilot_reply_template_prep_bundle=${bundle_dir}"
  echo "pilot_reply_template_prep_candidate_profile=${candidate_profile}"
  echo "pilot_reply_template_prep_candidate_profile_path=${candidate_profile_path}"
  echo "pilot_reply_template_prep_creation_plan=${creation_plan_path}"
  echo "pilot_reply_template_prep_create_sql=${create_sql_path}"
  echo "pilot_reply_template_prep_rollback_sql=${rollback_sql_path}"
  echo "pilot_reply_template_prep_intake=${intake_path}"
  echo "pilot_reply_template_prep_readiness=${readiness_result:-NO_GO}"
  echo "pilot_reply_template_prep_next_step=${next_step}"
  echo "pilot_reply_template_prep_decision=${overall_decision}"
} > "${summary_path}"

{
  echo "# Reply Template Prep"
  echo
  echo "- Source onboarding worksheet: \`${onboarding_path}\`"
  echo "- Reply template: \`${reply_template_path}\`"
  echo "- Processing bundle: \`${process_bundle_path:-unknown}\`"
  echo "- Applied onboarding worksheet: \`${applied_onboarding_path:-unknown}\`"
  echo "- Candidate profile: \`${candidate_profile:-unknown}\`"
  echo "- Candidate profile path: \`${candidate_profile_path:-unknown}\`"
  echo "- Intake export: \`${intake_path:-unknown}\`"
  echo "- Creation plan: \`${creation_plan_path:-unknown}\`"
  echo "- Create SQL: \`${create_sql_path:-unknown}\`"
  echo "- Rollback SQL: \`${rollback_sql_path:-unknown}\`"
  echo "- Readiness result: \`${readiness_result:-NO_GO}\`"
  echo "- Decision: \`${overall_decision}\`"
  if [[ "${overall_decision}" == "GO" ]]; then
    echo "- Next step: \`npm run pilot:inspect -- ${candidate_profile}\`"
  else
    echo "- Next step: review the logs in \`${logs_dir}\` and resolve the remaining issues before preparing the candidate again."
  fi
  echo
  echo "## Logs"
  echo
  echo "- Process log: \`${process_log}\`"
  echo "- Prepare log: \`${prepare_log}\`"
} > "${readme_path}"

cat "${summary_path}"

if [[ "${overall_decision}" != "GO" ]]; then
  exit 1
fi
