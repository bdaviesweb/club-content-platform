#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

intake_path="${PILOT_SANDBOX_INTAKE_PATH:-${repo_root}/docs/pilot-sandbox-intake.txt}"
profile_path="${repo_root}/config/pilot-candidates/sandbox-summit-pilot.local.env"
handoff_path="${repo_root}/tmp/sandbox-pilot-candidate-handoff.md"
creation_output_dir="${repo_root}/tmp/pilot-candidate-create-plan-sandbox"

if [[ ! -f "${intake_path}" ]]; then
  echo "Missing sandbox intake file: ${intake_path}" >&2
  exit 1
fi

rm -f "${profile_path}"
rm -f "${handoff_path}"
rm -rf "${creation_output_dir}"

PILOT_CANDIDATE_HANDOFF_PACKET_PATH="${handoff_path}" \
PILOT_CANDIDATE_CREATION_OUTPUT_DIR="${creation_output_dir}" \
  bash "${script_dir}/pilot_prepare_from_intake.sh" "${intake_path}"
