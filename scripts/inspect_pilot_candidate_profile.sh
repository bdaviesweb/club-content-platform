#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/load_pilot_candidate_env.sh" "${PILOT_CANDIDATE_PROFILE:-${1:-}}"

print_value() {
  local label="$1"
  local value="${2:-}"
  if [[ -z "${value}" ]]; then
    echo "${label}=<unset>"
  else
    echo "${label}=${value}"
  fi
}

echo "pilot_candidate_profile_inspection"
print_value "profile_name" "${PILOT_CANDIDATE_PROFILE_NAME:-}"
print_value "profile_path" "${PILOT_CANDIDATE_PROFILE_PATH:-}"
print_value "pilot_candidate" "${PILOT_CANDIDATE:-}"
print_value "organization_name" "${PILOT_ORGANIZATION_NAME:-}"
print_value "organization_slug" "${PILOT_ORGANIZATION_SLUG:-}"
print_value "club_name" "${PILOT_CLUB_NAME:-}"
print_value "club_slug" "${PILOT_CLUB_SLUG:-}"
print_value "team_name" "${PILOT_TEAM_NAME:-}"
print_value "team_slug" "${PILOT_TEAM_SLUG:-}"
print_value "submitter_email" "${SUBMITTER_EMAIL:-}"
print_value "organization_admin_email" "${ORGANIZATION_ADMIN_EMAIL:-}"
print_value "club_admin_email" "${CLUB_ADMIN_EMAIL:-}"
print_value "reviewer_email" "${REVIEWER_EMAIL:-}"
print_value "team_manager_reviewer_email" "${TEAM_MANAGER_REVIEWER_EMAIL:-}"
print_value "primary_reviewer_email" "${PRIMARY_REVIEWER_EMAIL:-}"
print_value "secondary_reviewer_email" "${SECOND_REVIEWER_EMAIL:-}"

if [[ -n "${PILOT_CANDIDATE_PROFILE_NAME:-}" ]]; then
  echo "validation_command=PILOT_CANDIDATE_PROFILE=${PILOT_CANDIDATE_PROFILE_NAME} bash scripts/validate_pilot_candidate_profile.sh"
  echo "audit_command=PILOT_CANDIDATE_PROFILE=${PILOT_CANDIDATE_PROFILE_NAME} npm run pilot:audit"
  echo "rehearsal_command=PILOT_CANDIDATE_PROFILE=${PILOT_CANDIDATE_PROFILE_NAME} npm run pilot:vps"
fi
