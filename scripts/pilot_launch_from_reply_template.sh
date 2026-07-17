#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-}"
reply_template_path="${2:-}"

if [[ -z "${onboarding_path}" || -z "${reply_template_path}" ]]; then
  echo "Usage: bash scripts/pilot_launch_from_reply_template.sh /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt" >&2
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

output_root="${PILOT_REPLY_TEMPLATE_LAUNCH_OUTPUT_DIR:-${repo_root}/tmp/pilot-reply-template-launch}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}"
logs_dir="${bundle_dir}/logs"
summary_path="${bundle_dir}/summary.txt"
readme_path="${bundle_dir}/README.md"
preflight_log="${logs_dir}/preflight-from-reply-template.log"
launch_log="${logs_dir}/launch-from-onboarding.log"

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
launch_status=0

run_capture "${preflight_log}" bash "${script_dir}/pilot_preflight_from_reply_template.sh" "${onboarding_path}" "${reply_template_path}" || preflight_status=$?

prep_bundle_path="$(extract_value "pilot_reply_template_preflight_prep_bundle" "${preflight_log}")"
candidate_profile="$(extract_value "pilot_reply_template_preflight_candidate_profile" "${preflight_log}")"
candidate_profile_path="$(extract_value "pilot_reply_template_preflight_candidate_profile_path" "${preflight_log}")"
create_sql_path="$(extract_value "pilot_reply_template_preflight_create_sql" "${preflight_log}")"
rollback_sql_path="$(extract_value "pilot_reply_template_preflight_rollback_sql" "${preflight_log}")"
preflight_result="$(extract_value "pilot_reply_template_preflight_profile_preflight" "${preflight_log}")"

applied_onboarding_path=""
if [[ -n "${prep_bundle_path}" ]]; then
  applied_onboarding_path="$(find "${prep_bundle_path}" -name 'pilot-onboarding.applied.md' -print | head -n 1)"
fi

if [[ "${preflight_status}" -eq 0 && -n "${applied_onboarding_path}" ]]; then
  run_capture "${launch_log}" bash "${script_dir}/pilot_launch_from_onboarding.sh" "${applied_onboarding_path}" || launch_status=$?
fi

launch_bundle_path="$(extract_value "pilot_real_launch_bundle_path" "${launch_log}")"
launch_handoff_path="$(extract_value "pilot_real_launch_handoff_path" "${launch_log}")"
create_bundle_path="$(extract_value "pilot_real_launch_create_bundle" "${launch_log}")"
verify_bundle_path="$(extract_value "pilot_real_launch_verify_bundle" "${launch_log}")"
rollback_bundle_path="$(extract_value "pilot_real_launch_rollback_bundle" "${launch_log}")"
rollback_command="$(extract_value "pilot_real_launch_rollback_command" "${launch_log}")"
launch_decision="$(extract_value "pilot_real_launch_decision" "${launch_log}")"

overall_decision="GO"
next_step="review_summary_bundle"
if [[ "${preflight_status}" -ne 0 || "${launch_status}" -ne 0 ]]; then
  overall_decision="NO_GO"
else
  next_step="operator_demo_and_evidence_capture"
fi

{
  echo "pilot_reply_template_launch_onboarding=${onboarding_path}"
  echo "pilot_reply_template_launch_reply_template=${reply_template_path}"
  echo "pilot_reply_template_launch_bundle=${bundle_dir}"
  echo "pilot_reply_template_launch_prep_bundle=${prep_bundle_path}"
  echo "pilot_reply_template_launch_applied_onboarding=${applied_onboarding_path}"
  echo "pilot_reply_template_launch_candidate_profile=${candidate_profile}"
  echo "pilot_reply_template_launch_candidate_profile_path=${candidate_profile_path}"
  echo "pilot_reply_template_launch_create_sql=${create_sql_path}"
  echo "pilot_reply_template_launch_rollback_sql=${rollback_sql_path}"
  echo "pilot_reply_template_launch_profile_preflight=${preflight_result:-failed}"
  echo "pilot_reply_template_launch_create_bundle=${create_bundle_path}"
  echo "pilot_reply_template_launch_verify_bundle=${verify_bundle_path}"
  echo "pilot_reply_template_launch_rollback_bundle=${rollback_bundle_path}"
  echo "pilot_reply_template_launch_rollback_command=${rollback_command}"
  echo "pilot_reply_template_launch_launch_bundle=${launch_bundle_path}"
  echo "pilot_reply_template_launch_handoff_path=${launch_handoff_path}"
  echo "pilot_reply_template_launch_decision=${overall_decision}"
  echo "pilot_reply_template_launch_next_step=${next_step}"
} > "${summary_path}"

{
  echo "# Reply Template Launch"
  echo
  echo "- Source onboarding worksheet: \`${onboarding_path}\`"
  echo "- Reply template: \`${reply_template_path}\`"
  echo "- Prep bundle: \`${prep_bundle_path:-unknown}\`"
  echo "- Applied onboarding worksheet: \`${applied_onboarding_path:-unknown}\`"
  echo "- Candidate profile: \`${candidate_profile:-unknown}\`"
  echo "- Candidate profile path: \`${candidate_profile_path:-unknown}\`"
  echo "- Create SQL: \`${create_sql_path:-unknown}\`"
  echo "- Rollback SQL: \`${rollback_sql_path:-unknown}\`"
  echo "- Profile preflight result: \`${preflight_result:-failed}\`"
  echo "- Hosted launch bundle: \`${launch_bundle_path:-unknown}\`"
  echo "- Hosted handoff path: \`${launch_handoff_path:-unknown}\`"
  echo "- Hosted create bundle: \`${create_bundle_path:-unknown}\`"
  echo "- Hosted verify bundle: \`${verify_bundle_path:-unknown}\`"
  echo "- Hosted rollback bundle: \`${rollback_bundle_path:-unknown}\`"
  echo "- Rollback command: \`${rollback_command:-unknown}\`"
  echo "- Decision: \`${overall_decision}\`"
  if [[ "${overall_decision}" == "GO" ]]; then
    echo "- Next step: operator demo and evidence capture"
  else
    echo "- Next step: review the logs in \`${logs_dir}\` and resolve the preflight or hosted launch issues."
  fi
  echo
  echo "## Logs"
  echo
  echo "- Preflight log: \`${preflight_log}\`"
  echo "- Launch log: \`${launch_log}\`"
} > "${readme_path}"

cat "${summary_path}"

if [[ "${overall_decision}" != "GO" ]]; then
  exit 1
fi
