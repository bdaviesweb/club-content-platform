#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-${PILOT_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-template.md}}"
intake_output_path="${PILOT_REAL_CANDIDATE_INTAKE_OUTPUT_PATH:-${repo_root}/tmp/pilot-real-candidate-intake.generated.txt}"

if [[ ! -f "${onboarding_path}" ]]; then
  echo "Missing onboarding worksheet: ${onboarding_path}" >&2
  exit 1
fi

mkdir -p "$(dirname "${intake_output_path}")"

set +e
validation_output="$(
  bash "${script_dir}/pilot_validate_onboarding.sh" "${onboarding_path}"
)"
validation_status=$?
set -e

if [[ "${validation_status}" -ne 0 ]]; then
  printf '%s\n' "${validation_output}"
  exit "${validation_status}"
fi

bash "${script_dir}/pilot_onboarding_to_intake.sh" "${onboarding_path}" > "${intake_output_path}"
prepare_output="$(
  bash "${script_dir}/pilot_prepare_from_intake.sh" "${intake_output_path}"
)"

printf '%s\n' "${validation_output}"
printf '%s\n' "${prepare_output}"
echo "pilot_prepare_onboarding=${onboarding_path}"
echo "pilot_prepare_onboarding_intake=${intake_output_path}"
