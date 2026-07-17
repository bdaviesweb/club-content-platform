#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

pilot_profile="${1:-${PILOT_CANDIDATE_PROFILE:-}}"
packet_path="${PILOT_CANDIDATE_HANDOFF_PACKET_PATH:-${repo_root}/tmp/pilot-candidate-handoff.md}"
demo_output_dir="${PILOT_DEMO_OUTPUT_DIR:-${repo_root}/tmp/pilot-demo}"
rehearsal_output_dir="${PILOT_REHEARSAL_OUTPUT_DIR:-${repo_root}/tmp/pilot-rehearsal}"

if [[ -z "${pilot_profile}" ]]; then
  echo "Usage: bash scripts/pilot_candidate_handoff_packet.sh <candidate-name-or-profile-path>" >&2
  exit 1
fi

latest_bundle_dir() {
  local bundle_root="$1"
  if [[ ! -d "${bundle_root}" ]]; then
    return 1
  fi

  find "${bundle_root}" -mindepth 1 -maxdepth 1 -type d ! -name runtime | sort | tail -n 1
}

demo_bundle_dir="$(latest_bundle_dir "${demo_output_dir}" || true)"
rehearsal_bundle_dir="$(latest_bundle_dir "${rehearsal_output_dir}" || true)"

inspect_output_file="$(mktemp)"
validate_output_file="$(mktemp)"
cleanup() {
  rm -f "${inspect_output_file}" "${validate_output_file}"
}
trap cleanup EXIT

inspect_status=0
validate_status=0

if npm run pilot:inspect -- "${pilot_profile}" > "${inspect_output_file}" 2>&1; then
  inspect_status=0
else
  inspect_status=$?
fi

if env PILOT_CANDIDATE_PROFILE="${pilot_profile}" bash "${script_dir}/validate_pilot_candidate_profile.sh" > "${validate_output_file}" 2>&1; then
  validate_status=0
else
  validate_status=$?
fi

profile_name="$(sed -n 's/^profile_name=//p' "${inspect_output_file}" | tail -n 1)"
profile_path="$(sed -n 's/^profile_path=//p' "${inspect_output_file}" | tail -n 1)"
profile_source="$(sed -n 's/^profile_source=//p' "${inspect_output_file}" | tail -n 1)"
organization_slug="$(sed -n 's/^organization_slug=//p' "${inspect_output_file}" | tail -n 1)"
club_slug="$(sed -n 's/^club_slug=//p' "${inspect_output_file}" | tail -n 1)"
team_slug="$(sed -n 's/^team_slug=//p' "${inspect_output_file}" | tail -n 1)"

if [[ -z "${profile_name}" ]]; then
  profile_name="${pilot_profile}"
fi

decision="GO"
if [[ "${inspect_status}" -ne 0 || "${validate_status}" -ne 0 ]]; then
  decision="NO_GO"
fi

mkdir -p "$(dirname "${packet_path}")"

{
  echo "# Pilot Candidate Handoff Packet"
  echo
  echo "- Candidate profile: \`${profile_name}\`"
  echo "- Candidate source: \`${profile_source:-unknown}\`"
  echo "- Candidate profile path: \`${profile_path:-unknown}\`"
  echo "- Decision: \`${decision}\`"
  echo "- Organization slug: \`${organization_slug:-<unset>}\`"
  echo "- Club slug: \`${club_slug:-<unset>}\`"
  echo "- Team slug: \`${team_slug:-<unset>}\`"
  echo "- Candidate handoff guide: \`${repo_root}/docs/pilot-candidate-handoff.md\`"
  echo "- Onboarding worksheet: \`${repo_root}/docs/pilot-onboarding-template.md\`"
  echo "- Activation checklist: \`${repo_root}/docs/pilot-activation-checklist.md\`"
  echo "- Launch playbook: \`${repo_root}/docs/pilot-launch.md\`"
  if [[ -n "${demo_bundle_dir}" ]]; then
    echo "- Latest test-tenant demo bundle: \`${demo_bundle_dir}\`"
  else
    echo "- Latest test-tenant demo bundle: \`<missing>\`"
  fi
  if [[ -n "${rehearsal_bundle_dir}" ]]; then
    echo "- Latest test-tenant rehearsal bundle: \`${rehearsal_bundle_dir}\`"
  else
    echo "- Latest test-tenant rehearsal bundle: \`<missing>\`"
  fi
  echo
  echo "## Pre-Creation Boundary"
  echo
  echo "Use this packet before any real organization, club, team, or reviewer records are created."
  echo
  echo "Safe now:"
  echo "- scaffold and edit the local candidate profile"
  echo "- inspect the resolved candidate values"
  echo "- run the candidate preflight validator"
  echo "- capture ownership, signoff, and rollback decisions"
  echo "- keep demo and rehearsal proof on the test-tenant profile"
  echo
  echo "Not safe yet:"
  echo "- candidate-specific hosted audit"
  echo "- candidate-specific VPS scenarios"
  echo "- candidate-specific full rehearsal"
  echo "- any mutation that assumes the real organization records already exist"
  echo
  echo "## Operator Commands"
  echo
  echo "1. \`npm run pilot:profile -- ${profile_name}\`"
  echo "2. \`npm run pilot:inspect -- ${profile_name}\`"
  echo "3. \`PILOT_CANDIDATE_PROFILE=${profile_name} bash scripts/validate_pilot_candidate_profile.sh\`"
  echo "4. Fill out \`docs/pilot-onboarding-template.md\`"
  echo "5. Fill out \`docs/pilot-activation-checklist.md\`"
  echo "6. Keep \`npm run demo:pilot\` and \`npm run pilot:rehearse\` on the test-tenant profile until real records exist"
  echo
  echo "## Ownership Checklist"
  echo
  echo "- Launch decision owner:"
  echo "- Day-one operator:"
  echo "- Reviewer owner for \`team_manager\`:"
  echo "- Reviewer owner for \`club_comms\`:"
  echo "- Reviewer owner for \`club_admin\`:"
  echo "- Escalation contact:"
  echo "- Rollback owner:"
  echo
  echo "## Rollback Checklist"
  echo
  echo "- Rollback trigger:"
  echo "- First override to remove:"
  echo "- Scenarios to rerun after rollback:"
  echo "- Pilot-club communication owner:"
  echo "- Notification posture on day one:"
  echo
  echo "## Profile Inspection Output"
  echo
  echo '```text'
  cat "${inspect_output_file}"
  echo '```'
  echo
  echo "## Profile Preflight Output"
  echo
  echo '```text'
  cat "${validate_output_file}"
  echo '```'
} > "${packet_path}"

echo "pilot_candidate_handoff_packet_path=${packet_path}"
echo "pilot_candidate_handoff_profile=${profile_name}"
echo "pilot_candidate_handoff_decision=${decision}"
if [[ -n "${demo_bundle_dir}" ]]; then
  echo "pilot_candidate_handoff_demo_bundle=${demo_bundle_dir}"
fi
if [[ -n "${rehearsal_bundle_dir}" ]]; then
  echo "pilot_candidate_handoff_rehearsal_bundle=${rehearsal_bundle_dir}"
fi

if [[ "${decision}" != "GO" ]]; then
  exit 1
fi
