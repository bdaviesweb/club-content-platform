#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

intake_path="${1:-${PILOT_REAL_CANDIDATE_INTAKE_PATH:-${repo_root}/docs/pilot-real-candidate-intake.md}}"

if [[ ! -f "${intake_path}" ]]; then
  echo "Missing intake file: ${intake_path}" >&2
  exit 1
fi

profile_output="$(
  bash "${script_dir}/pilot_candidate_profile_from_intake.sh" "${intake_path}"
)"

created_profile_path="$(printf "%s\n" "${profile_output}" | sed -n 's/^created_profile=//p' | tail -n 1)"
candidate_profile_name="$(basename "${created_profile_path}" .local.env)"

if [[ -z "${created_profile_path}" || -z "${candidate_profile_name}" ]]; then
  echo "Failed to determine the created candidate profile from intake output." >&2
  printf '%s\n' "${profile_output}" >&2
  exit 1
fi

handoff_output="$(
  bash "${script_dir}/pilot_candidate_handoff_packet.sh" "${candidate_profile_name}"
)"
creation_output="$(
  bash "${script_dir}/pilot_candidate_creation_plan.sh" "${candidate_profile_name}"
)"
readiness_output="$(
  bash "${script_dir}/pilot_real_candidate_readiness.sh" "${intake_path}"
)"

handoff_packet_path="$(printf "%s\n" "${handoff_output}" | sed -n 's/^pilot_candidate_handoff_packet_path=//p' | tail -n 1)"
creation_plan_path="$(printf "%s\n" "${creation_output}" | sed -n 's/^pilot_candidate_creation_plan=//p' | tail -n 1)"
create_sql_path="$(printf "%s\n" "${creation_output}" | sed -n 's/^pilot_candidate_creation_create_sql=//p' | tail -n 1)"
rollback_sql_path="$(printf "%s\n" "${creation_output}" | sed -n 's/^pilot_candidate_creation_rollback_sql=//p' | tail -n 1)"
readiness_status="$(printf "%s\n" "${readiness_output}" | sed -n 's/^pilot_real_candidate_readiness=//p' | tail -n 1)"

printf '%s\n' "${profile_output}"
printf '%s\n' "${handoff_output}"
printf '%s\n' "${creation_output}"
printf '%s\n' "${readiness_output}"
echo "pilot_prepare_intake=${intake_path}"
echo "pilot_prepare_profile=${candidate_profile_name}"
echo "pilot_prepare_profile_path=${created_profile_path}"
echo "pilot_prepare_handoff_packet=${handoff_packet_path}"
echo "pilot_prepare_creation_plan=${creation_plan_path}"
echo "pilot_prepare_create_sql=${create_sql_path}"
echo "pilot_prepare_rollback_sql=${rollback_sql_path}"
echo "pilot_prepare_readiness=${readiness_status:-unknown}"
