#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
candidates_dir="${repo_root}/config/pilot-candidates"
template_path="${candidates_dir}/pilot-candidate.template.env"

candidate_name="${1:-}"

if [[ -z "${candidate_name}" ]]; then
  echo "Usage: bash scripts/create_pilot_candidate_profile.sh <candidate-name>" >&2
  exit 1
fi

if [[ ! "${candidate_name}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Candidate name must use lowercase letters, numbers, and hyphens only: ${candidate_name}" >&2
  exit 1
fi

destination_path="${candidates_dir}/${candidate_name}.local.env"

if [[ ! -f "${template_path}" ]]; then
  echo "Missing pilot candidate template: ${template_path}" >&2
  exit 1
fi

if [[ -e "${destination_path}" ]]; then
  echo "Pilot candidate profile already exists: ${destination_path}" >&2
  exit 1
fi

cp "${template_path}" "${destination_path}"
perl -0pi -e "s/^PILOT_CANDIDATE_PROFILE_NAME=.*/PILOT_CANDIDATE_PROFILE_NAME=${candidate_name}/m" "${destination_path}"

echo "created_profile=${destination_path}"
echo "next_step=edit_profile_values"
echo "inspect_command=npm run pilot:inspect -- ${candidate_name}"
echo "validate_command=PILOT_CANDIDATE_PROFILE=${candidate_name} bash scripts/validate_pilot_candidate_profile.sh"
echo "audit_command=PILOT_CANDIDATE_PROFILE=${candidate_name} npm run pilot:audit"
echo "rehearsal_command=PILOT_CANDIDATE_PROFILE=${candidate_name} npm run pilot:vps"
echo "preflight_note=validation should fail until template placeholder values are replaced"
