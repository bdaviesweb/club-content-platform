#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

source_onboarding_path="${1:-${PILOT_SOURCE_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-north-river-youth-sports.md}}"
output_root="${PILOT_REAL_CANDIDATE_KIT_OUTPUT_DIR:-${repo_root}/tmp/pilot-real-candidate-kit}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}"

scaffolded_onboarding_path="${bundle_dir}/pilot-onboarding-real-candidate.md"
gap_report_path="${bundle_dir}/onboarding-gaps.txt"
request_packet_path="${bundle_dir}/pilot-real-data-request.md"
share_message_path="${bundle_dir}/pilot-real-data-request-message.txt"
summary_path="${bundle_dir}/summary.txt"
readme_path="${bundle_dir}/README.md"

mkdir -p "${bundle_dir}"

scaffold_output="$(
  bash "${script_dir}/pilot_scaffold_real_onboarding.sh" "${source_onboarding_path}" "${scaffolded_onboarding_path}"
)"

set +e
gap_output="$(
  bash "${script_dir}/pilot_real_onboarding_gaps.sh" "${scaffolded_onboarding_path}"
)"
gap_status=$?
set -e
printf '%s\n' "${gap_output}" > "${gap_report_path}"

request_output="$(
  bash "${script_dir}/pilot_real_data_request_packet.sh" "${scaffolded_onboarding_path}" "${request_packet_path}"
)"

share_output="$(
  bash "${script_dir}/pilot_share_real_data_request.sh" "${request_packet_path}" "${share_message_path}"
)"

gap_count="$(printf '%s\n' "${gap_output}" | sed -n 's/^pilot_real_onboarding_gap_count=//p' | tail -n 1)"
if [[ -z "${gap_count}" ]]; then
  gap_count="0"
fi

{
  echo "pilot_real_candidate_kit_source=${source_onboarding_path}"
  echo "pilot_real_candidate_kit_bundle=${bundle_dir}"
  echo "pilot_real_candidate_kit_onboarding=${scaffolded_onboarding_path}"
  echo "pilot_real_candidate_kit_gap_report=${gap_report_path}"
  echo "pilot_real_candidate_kit_request_packet=${request_packet_path}"
  echo "pilot_real_candidate_kit_share_message=${share_message_path}"
  echo "pilot_real_candidate_kit_gap_count=${gap_count}"
  if [[ "${gap_status}" -eq 0 ]]; then
    echo "pilot_real_candidate_kit_status=ready"
  else
    echo "pilot_real_candidate_kit_status=needs_input"
  fi
} > "${summary_path}"

{
  echo "# Real Candidate Prep Kit"
  echo
  echo "- Source simulator onboarding: \`${source_onboarding_path}\`"
  echo "- Scaffolded onboarding worksheet: \`${scaffolded_onboarding_path}\`"
  echo "- Gap report: \`${gap_report_path}\`"
  echo "- Request packet: \`${request_packet_path}\`"
  echo "- Share message: \`${share_message_path}\`"
  echo "- Remaining gap count: \`${gap_count}\`"
  echo
  echo "## How To Use"
  echo
  echo "1. Fill the scaffolded onboarding worksheet with the real club details."
  echo "2. Review the grouped gap report to confirm what is still missing."
  echo "3. Send the share message if someone else needs to provide the missing inputs."
  echo "4. Rerun the gap check and request-packet commands after updates."
  echo
  echo "## Commands"
  echo
  echo "- \`npm run pilot:onboarding-gaps -- ${scaffolded_onboarding_path}\`"
  echo "- \`npm run pilot:data-request -- ${scaffolded_onboarding_path} ${request_packet_path}\`"
  echo "- \`npm run pilot:share-data-request -- ${request_packet_path} ${share_message_path}\`"
} > "${readme_path}"

printf '%s\n' "${scaffold_output}"
printf '%s\n' "${request_output}"
printf '%s\n' "${share_output}"
cat "${summary_path}"
