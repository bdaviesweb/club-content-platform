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

profile_source="direct"
if [[ "${PILOT_CANDIDATE_PROFILE_PATH:-}" == *".local.env" ]]; then
  profile_source="local"
elif [[ "${PILOT_CANDIDATE_PROFILE_PATH:-}" == *".env" ]]; then
  profile_source="committed"
fi

echo "pilot_candidate_profile_inspection"
print_value "profile_source" "${profile_source}"
print_value "profile_name" "${PILOT_CANDIDATE_PROFILE_NAME:-}"
print_value "profile_path" "${PILOT_CANDIDATE_PROFILE_PATH:-}"
print_value "pilot_candidate" "${PILOT_CANDIDATE:-}"
print_value "organization_name" "${PILOT_ORGANIZATION_NAME:-}"
print_value "organization_slug" "${PILOT_ORGANIZATION_SLUG:-}"
print_value "club_name" "${PILOT_CLUB_NAME:-}"
print_value "club_slug" "${PILOT_CLUB_SLUG:-}"
print_value "team_name" "${PILOT_TEAM_NAME:-}"
print_value "team_slug" "${PILOT_TEAM_SLUG:-}"
print_value "age_group" "${PILOT_AGE_GROUP:-}"
print_value "submitter_name" "${SUBMITTER_NAME:-}"
print_value "submitter_email" "${SUBMITTER_EMAIL:-}"
print_value "organization_admin_name" "${ORGANIZATION_ADMIN_NAME:-}"
print_value "organization_admin_email" "${ORGANIZATION_ADMIN_EMAIL:-}"
print_value "club_admin_name" "${CLUB_ADMIN_NAME:-}"
print_value "club_admin_email" "${CLUB_ADMIN_EMAIL:-}"
print_value "reviewer_name" "${REVIEWER_NAME:-}"
print_value "reviewer_email" "${REVIEWER_EMAIL:-}"
print_value "team_manager_reviewer_name" "${TEAM_MANAGER_REVIEWER_NAME:-}"
print_value "team_manager_reviewer_email" "${TEAM_MANAGER_REVIEWER_EMAIL:-}"
print_value "primary_reviewer_name" "${PRIMARY_REVIEWER_NAME:-}"
print_value "primary_reviewer_email" "${PRIMARY_REVIEWER_EMAIL:-}"
print_value "secondary_reviewer_name" "${SECOND_REVIEWER_NAME:-}"
print_value "secondary_reviewer_email" "${SECOND_REVIEWER_EMAIL:-}"
print_value "org_default_approver_role" "${PILOT_ORG_DEFAULT_APPROVER_ROLE:-}"
print_value "org_public_approver_role" "${PILOT_ORG_PUBLIC_APPROVER_ROLE:-}"
print_value "org_medium_risk_approver_role" "${PILOT_ORG_MEDIUM_RISK_APPROVER_ROLE:-}"
print_value "org_allow_agent_routing" "${PILOT_ORG_ALLOW_AGENT_ROUTING:-}"
print_value "org_auto_approve_internal_low_risk" "${PILOT_ORG_AUTO_APPROVE_INTERNAL_LOW_RISK:-}"
print_value "org_auto_approve_max_risk" "${PILOT_ORG_AUTO_APPROVE_MAX_RISK:-}"
print_value "org_auto_approval_allowed_content_types" "${PILOT_ORG_AUTO_APPROVAL_ALLOWED_CONTENT_TYPES:-}"
print_value "org_routing_video_approver_role" "${PILOT_ORG_ROUTING_VIDEO_APPROVER_ROLE:-}"
print_value "org_require_second_approval_public" "${PILOT_ORG_REQUIRE_SECOND_APPROVAL_PUBLIC:-}"
print_value "org_second_approver_role" "${PILOT_ORG_SECOND_APPROVER_ROLE:-}"
print_value "org_second_approval_content_types" "${PILOT_ORG_SECOND_APPROVAL_CONTENT_TYPES:-}"
print_value "org_notification_email" "${PILOT_ORG_NOTIFICATION_EMAIL:-}"
print_value "org_notification_push" "${PILOT_ORG_NOTIFICATION_PUSH:-}"
print_value "club_policy_inherits_org_defaults" "${PILOT_CLUB_POLICY_INHERITS_ORG_DEFAULTS:-}"
print_value "club_override_auto_approve_internal_low_risk" "${PILOT_CLUB_OVERRIDE_AUTO_APPROVE_INTERNAL_LOW_RISK:-}"
print_value "club_override_routing_video_approver_role" "${PILOT_CLUB_OVERRIDE_ROUTING_VIDEO_APPROVER_ROLE:-}"
print_value "club_override_require_second_approval_public" "${PILOT_CLUB_OVERRIDE_REQUIRE_SECOND_APPROVAL_PUBLIC:-}"
print_value "club_override_notification_email" "${PILOT_CLUB_OVERRIDE_NOTIFICATION_EMAIL:-}"
print_value "club_override_notification_push" "${PILOT_CLUB_OVERRIDE_NOTIFICATION_PUSH:-}"

if [[ -n "${PILOT_CANDIDATE_PROFILE_NAME:-}" ]]; then
  echo "inspect_command=npm run pilot:inspect -- ${PILOT_CANDIDATE_PROFILE_NAME}"
  echo "preflight_command=PILOT_CANDIDATE_PROFILE=${PILOT_CANDIDATE_PROFILE_NAME} bash scripts/validate_pilot_candidate_profile.sh"
  echo "validation_command=PILOT_CANDIDATE_PROFILE=${PILOT_CANDIDATE_PROFILE_NAME} bash scripts/validate_pilot_candidate_profile.sh"
  echo "audit_command=PILOT_CANDIDATE_PROFILE=${PILOT_CANDIDATE_PROFILE_NAME} npm run pilot:audit"
  echo "rehearsal_command=PILOT_CANDIDATE_PROFILE=${PILOT_CANDIDATE_PROFILE_NAME} npm run pilot:vps"
fi
