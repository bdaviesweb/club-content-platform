#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-${PILOT_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-template.md}}"
output_path="${2:-${PILOT_REAL_DATA_REQUEST_OUTPUT_PATH:-${repo_root}/tmp/pilot-real-data-request.md}}"

if [[ ! -f "${onboarding_path}" ]]; then
  echo "Missing onboarding worksheet: ${onboarding_path}" >&2
  exit 1
fi

set +e
gap_output="$(
  bash "${script_dir}/pilot_real_onboarding_gaps.sh" "${onboarding_path}"
)"
gap_status=$?
set -e

mkdir -p "$(dirname "${output_path}")"

collect_section() {
  local category="$1"
  local labels=""
  local current_category=""
  local current_label=""

  while IFS= read -r line; do
    case "${line}" in
      pilot_real_onboarding_gap_category=*)
        current_category="${line#pilot_real_onboarding_gap_category=}"
        ;;
      pilot_real_onboarding_gap_label=*)
        current_label="${line#pilot_real_onboarding_gap_label=}"
        if [[ "${current_category}" == "${category}" ]]; then
          labels="${labels}"$'\n'"- ${current_label}"
        fi
        ;;
    esac
  done <<< "${gap_output}"

  printf "%s" "${labels}"
}

candidate_identity_items="$(collect_section "Candidate identity")"
people_items="$(collect_section "People and ownership")"
delivery_items="$(collect_section "Delivery and destinations")"
rollback_items="$(collect_section "Rollback")"
launch_evidence_items="$(collect_section "Launch evidence")"

gap_count="$(printf '%s\n' "${gap_output}" | sed -n 's/^pilot_real_onboarding_gap_count=//p' | tail -n 1)"
if [[ -z "${gap_count}" ]]; then
  gap_count="0"
fi

{
  echo "# Pilot Real Data Request"
  echo
  echo "- Source onboarding worksheet: \`${onboarding_path}\`"
  echo "- Remaining gap count: \`${gap_count}\`"
  echo
  echo "Use this request packet to collect only the missing real-club details for the first pilot candidate."
  echo "The workflow defaults and policy posture can stay as scaffolded unless the club wants changes."
  echo
  echo "## Needed Before Record Creation"
  echo
  echo "These items are needed before we can safely generate the real candidate profile, create SQL, and ownership plan."
  echo
  if [[ -n "${candidate_identity_items}" ]]; then
    echo "### Candidate Identity"
    echo
    printf '%s\n' "${candidate_identity_items}"
    echo
  fi
  if [[ -n "${people_items}" ]]; then
    echo "### People and Ownership"
    echo
    printf '%s\n' "${people_items}"
    echo
  fi
  if [[ -n "${delivery_items}" ]]; then
    echo "### Delivery and Destinations"
    echo
    printf '%s\n' "${delivery_items}"
    echo
  fi
  if [[ -n "${rollback_items}" ]]; then
    echo "### Rollback"
    echo
    printf '%s\n' "${rollback_items}"
    echo
  fi
  echo "## Needed Before Live Launch"
  echo
  echo "These items can stay open until after the real records exist, but they must be complete before any live club use."
  echo
  if [[ -n "${launch_evidence_items}" ]]; then
    printf '%s\n' "${launch_evidence_items}"
  else
    echo "- No remaining launch-evidence gaps"
  fi
  echo
  echo "## Operator Notes"
  echo
  echo "- After these fields are filled, rerun \`npm run pilot:onboarding-gaps -- ${onboarding_path}\`."
  echo "- When the gap report returns \`pilot_real_onboarding_gaps=GO\`, the worksheet is ready for the hosted launch path."
  echo "- The hosted create flow will still stop if \`pilot:check-launch-readiness\` is not satisfied."
} > "${output_path}"

echo "pilot_real_data_request_source=${onboarding_path}"
echo "pilot_real_data_request_output=${output_path}"
echo "pilot_real_data_request_gap_count=${gap_count}"
if [[ "${gap_status}" -eq 0 ]]; then
  echo "pilot_real_data_request_status=ready"
else
  echo "pilot_real_data_request_status=needs_input"
fi
