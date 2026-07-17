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

yes_no_optional_vars=(
  PILOT_ORG_ALLOW_AGENT_ROUTING
  PILOT_ORG_AUTO_APPROVE_INTERNAL_LOW_RISK
  PILOT_ORG_REQUIRE_SECOND_APPROVAL_PUBLIC
  PILOT_ORG_NOTIFICATION_EMAIL
  PILOT_ORG_NOTIFICATION_PUSH
  PILOT_CLUB_POLICY_INHERITS_ORG_DEFAULTS
  PILOT_CLUB_OVERRIDE_AUTO_APPROVE_INTERNAL_LOW_RISK
  PILOT_CLUB_OVERRIDE_REQUIRE_SECOND_APPROVAL_PUBLIC
  PILOT_CLUB_OVERRIDE_NOTIFICATION_EMAIL
  PILOT_CLUB_OVERRIDE_NOTIFICATION_PUSH
)

role_optional_vars=(
  PILOT_ORG_DEFAULT_APPROVER_ROLE
  PILOT_ORG_PUBLIC_APPROVER_ROLE
  PILOT_ORG_MEDIUM_RISK_APPROVER_ROLE
  PILOT_ORG_ROUTING_VIDEO_APPROVER_ROLE
  PILOT_ORG_SECOND_APPROVER_ROLE
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

for yes_no_var in "${yes_no_optional_vars[@]}"; do
  yes_no_value="${!yes_no_var:-}"
  [[ -z "${yes_no_value}" ]] && continue
  if [[ "${yes_no_value}" != "yes" && "${yes_no_value}" != "no" ]]; then
    echo "${yes_no_var} must be yes or no: ${yes_no_value}" >&2
    exit 1
  fi
done

for role_var in "${role_optional_vars[@]}"; do
  role_value="${!role_var:-}"
  [[ -z "${role_value}" ]] && continue
  if [[ ! "${role_value}" =~ ^(submitter_coach|team_manager|club_comms|club_admin)$ ]]; then
    echo "${role_var} must be a valid membership role: ${role_value}" >&2
    exit 1
  fi
done

if [[ -n "${PILOT_ORG_AUTO_APPROVE_MAX_RISK:-}" ]] && [[ ! "${PILOT_ORG_AUTO_APPROVE_MAX_RISK}" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "PILOT_ORG_AUTO_APPROVE_MAX_RISK must be numeric: ${PILOT_ORG_AUTO_APPROVE_MAX_RISK}" >&2
  exit 1
fi

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
