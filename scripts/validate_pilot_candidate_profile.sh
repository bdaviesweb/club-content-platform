#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/load_pilot_candidate_env.sh" "${PILOT_CANDIDATE_PROFILE:-${1:-}}"

required_vars=(
  PILOT_CANDIDATE_PROFILE_NAME
  PILOT_ORGANIZATION_NAME
  PILOT_ORGANIZATION_SLUG
  ORGANIZATION_SLUG
  PILOT_CLUB_NAME
  PILOT_CLUB_SLUG
  CLUB_SLUG
  PILOT_TEAM_NAME
  PILOT_TEAM_SLUG
  TEAM_SLUG
  SUBMITTER_EMAIL
  ORGANIZATION_ADMIN_EMAIL
  CLUB_ADMIN_EMAIL
  REVIEWER_EMAIL
  TEAM_MANAGER_REVIEWER_EMAIL
)

missing=()
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("${var_name}")
  fi
done

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "Pilot candidate profile is missing required values:" >&2
  printf ' - %s\n' "${missing[@]}" >&2
  exit 1
fi

placeholder_checks=(
  "PILOT_CANDIDATE_PROFILE_NAME:replace-with-candidate-name"
  "PILOT_ORGANIZATION_NAME:Replace With Organization Name"
  "PILOT_ORGANIZATION_SLUG:replace-with-organization-slug"
  "ORGANIZATION_SLUG:replace-with-organization-slug"
  "PILOT_CLUB_NAME:Replace With Club Name"
  "PILOT_CLUB_SLUG:replace-with-club-slug"
  "CLUB_SLUG:replace-with-club-slug"
  "PILOT_TEAM_NAME:Replace With Team Name"
  "PILOT_TEAM_SLUG:replace-with-team-slug"
  "TEAM_SLUG:replace-with-team-slug"
  "SUBMITTER_EMAIL:submitter@example.com"
  "ORGANIZATION_ADMIN_EMAIL:org-admin@example.com"
  "CLUB_ADMIN_EMAIL:club-admin@example.com"
  "REVIEWER_EMAIL:club-comms@example.com"
  "TEAM_MANAGER_REVIEWER_EMAIL:team-manager@example.com"
  "PRIMARY_REVIEWER_EMAIL:team-manager@example.com"
  "SECOND_REVIEWER_EMAIL:club-admin@example.com"
)

template_values=()
for placeholder_check in "${placeholder_checks[@]}"; do
  var_name="${placeholder_check%%:*}"
  expected_value="${placeholder_check#*:}"
  actual_value="${!var_name:-}"
  if [[ "${actual_value}" == "${expected_value}" ]]; then
    template_values+=("${var_name}=${actual_value}")
  fi
done

if [[ "${#template_values[@]}" -gt 0 ]]; then
  echo "Pilot candidate profile still contains template placeholder values:" >&2
  printf ' - %s\n' "${template_values[@]}" >&2
  echo "Run: npm run pilot:inspect -- ${PILOT_CANDIDATE_PROFILE_NAME:-${1:-candidate}}" >&2
  echo "Replace the placeholder values before treating this profile as candidate-ready." >&2
  exit 1
fi

if [[ "${PILOT_ORGANIZATION_SLUG}" != "${ORGANIZATION_SLUG}" ]]; then
  echo "PILOT_ORGANIZATION_SLUG must match ORGANIZATION_SLUG" >&2
  exit 1
fi

if [[ "${PILOT_CLUB_SLUG}" != "${CLUB_SLUG}" ]]; then
  echo "PILOT_CLUB_SLUG must match CLUB_SLUG" >&2
  exit 1
fi

if [[ "${PILOT_TEAM_SLUG}" != "${TEAM_SLUG}" ]]; then
  echo "PILOT_TEAM_SLUG must match TEAM_SLUG" >&2
  exit 1
fi

for email_var in SUBMITTER_EMAIL ORGANIZATION_ADMIN_EMAIL CLUB_ADMIN_EMAIL REVIEWER_EMAIL TEAM_MANAGER_REVIEWER_EMAIL PRIMARY_REVIEWER_EMAIL SECOND_REVIEWER_EMAIL; do
  email_value="${!email_var:-}"
  [[ -z "${email_value}" ]] && continue
  if [[ ! "${email_value}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
    echo "${email_var} must be a valid email address: ${email_value}" >&2
    exit 1
  fi
done

echo "pilot_candidate_profile=${PILOT_CANDIDATE_PROFILE_NAME}"
echo "profile_path=${PILOT_CANDIDATE_PROFILE_PATH:-unknown}"
echo "organization_slug=${ORGANIZATION_SLUG}"
echo "club_slug=${CLUB_SLUG}"
echo "team_slug=${TEAM_SLUG}"
echo "submitter_email=${SUBMITTER_EMAIL}"
echo "reviewer_email=${REVIEWER_EMAIL}"
echo "team_manager_reviewer_email=${TEAM_MANAGER_REVIEWER_EMAIL}"
echo "preflight_result=ok"
echo "validation_result=ok"
