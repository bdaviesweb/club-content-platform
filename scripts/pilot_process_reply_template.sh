#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-}"
reply_template_path="${2:-}"

if [[ -z "${onboarding_path}" || -z "${reply_template_path}" ]]; then
  echo "Usage: bash scripts/pilot_process_reply_template.sh /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt" >&2
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

output_root="${PILOT_REPLY_TEMPLATE_OUTPUT_DIR:-${repo_root}/tmp/pilot-reply-template-processing}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}"
logs_dir="${bundle_dir}/logs"
applied_onboarding_path="${bundle_dir}/pilot-onboarding.applied.md"
summary_path="${bundle_dir}/summary.txt"
readme_path="${bundle_dir}/README.md"
apply_log="${logs_dir}/apply-reply-template.log"
validate_log="${logs_dir}/validate-onboarding.log"
gaps_log="${logs_dir}/onboarding-gaps.log"
readiness_log="${logs_dir}/launch-readiness.log"

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
  sed -n "s/^${key}=//p" "${path}" | tail -n 1
}

apply_status=0
validate_status=0
gaps_status=0
readiness_status=0
overall_status=0

run_capture "${apply_log}" bash "${script_dir}/pilot_apply_reply_template.sh" "${onboarding_path}" "${reply_template_path}" "${applied_onboarding_path}" || apply_status=$?

if [[ "${apply_status}" -eq 0 ]]; then
  run_capture "${validate_log}" bash "${script_dir}/pilot_validate_onboarding.sh" "${applied_onboarding_path}" || validate_status=$?
  run_capture "${gaps_log}" bash "${script_dir}/pilot_real_onboarding_gaps.sh" "${applied_onboarding_path}" || gaps_status=$?
  run_capture "${readiness_log}" bash "${script_dir}/pilot_check_launch_readiness.sh" "${applied_onboarding_path}" || readiness_status=$?
else
  validate_status=1
  gaps_status=1
  readiness_status=1
fi

if [[ "${apply_status}" -ne 0 || "${validate_status}" -ne 0 || "${gaps_status}" -ne 0 || "${readiness_status}" -ne 0 ]]; then
  overall_status=1
fi

validation_result="$(extract_value "pilot_onboarding_validation" "${validate_log}")"
gap_count="$(extract_value "pilot_real_onboarding_gap_count" "${gaps_log}")"
gap_result="$(extract_value "pilot_real_onboarding_gaps" "${gaps_log}")"
readiness_result="$(extract_value "pilot_launch_readiness" "${readiness_log}")"

{
  echo "pilot_reply_template_process_onboarding=${onboarding_path}"
  echo "pilot_reply_template_process_reply_template=${reply_template_path}"
  echo "pilot_reply_template_process_applied_onboarding=${applied_onboarding_path}"
  echo "pilot_reply_template_process_bundle=${bundle_dir}"
  echo "pilot_reply_template_process_apply_status=${apply_status}"
  echo "pilot_reply_template_process_validation=${validation_result:-NO_GO}"
  echo "pilot_reply_template_process_gap_result=${gap_result:-NO_GO}"
  echo "pilot_reply_template_process_gap_count=${gap_count:-unknown}"
  echo "pilot_reply_template_process_readiness=${readiness_result:-NO_GO}"
  if [[ "${overall_status}" -eq 0 ]]; then
    echo "pilot_reply_template_process_next_step=prepare_from_onboarding"
    echo "pilot_reply_template_process_decision=GO"
  else
    echo "pilot_reply_template_process_next_step=review_summary_bundle"
    echo "pilot_reply_template_process_decision=NO_GO"
  fi
} > "${summary_path}"

{
  echo "# Reply Template Processing"
  echo
  echo "- Source onboarding worksheet: \`${onboarding_path}\`"
  echo "- Reply template: \`${reply_template_path}\`"
  echo "- Applied onboarding worksheet: \`${applied_onboarding_path}\`"
  echo "- Validation result: \`${validation_result:-NO_GO}\`"
  echo "- Gap result: \`${gap_result:-NO_GO}\`"
  echo "- Gap count: \`${gap_count:-unknown}\`"
  echo "- Launch readiness result: \`${readiness_result:-NO_GO}\`"
  if [[ "${overall_status}" -eq 0 ]]; then
    echo "- Decision: \`GO\`"
    echo "- Next step: \`npm run pilot:prepare-from-onboarding -- ${applied_onboarding_path}\`"
  else
    echo "- Decision: \`NO_GO\`"
    echo "- Next step: review the logs in \`${logs_dir}\` and finish the remaining worksheet fields or launch evidence."
  fi
  echo
  echo "## Logs"
  echo
  echo "- Apply log: \`${apply_log}\`"
  echo "- Validate log: \`${validate_log}\`"
  echo "- Gap log: \`${gaps_log}\`"
  echo "- Readiness log: \`${readiness_log}\`"
} > "${readme_path}"

cat "${summary_path}"

if [[ "${overall_status}" -ne 0 ]]; then
  exit 1
fi
