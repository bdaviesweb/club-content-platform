#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

intake_path="${1:-${PILOT_REAL_CANDIDATE_INTAKE_PATH:-${repo_root}/docs/pilot-real-candidate-intake.md}}"

if [[ ! -f "${intake_path}" ]]; then
  echo "Missing intake file: ${intake_path}" >&2
  exit 1
fi

extract_markdown_field() {
  local label="$1"
  awk -F': ' -v label="$label" '
    $0 ~ "^- " label ":" {
      sub("^- " label ": ?", "", $0)
      print $0
      exit
    }
  ' "${intake_path}"
}

strip_value() {
  printf "%s" "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

extract_block_field() {
  local key="$1"
  awk -F'=' -v key="$key" '
    $0 ~ "^[[:space:]]*" key "=" {
      sub("^[[:space:]]*" key "=", "", $0)
      print $0
      exit
    }
  ' "${intake_path}"
}

detect_input_format() {
  if grep -Eq '^[[:space:]]*candidate_profile_name=' "${intake_path}"; then
    echo "key_value_block"
  else
    echo "markdown_intake"
  fi
}

input_format="$(detect_input_format)"

load_value() {
  local markdown_label="$1"
  local block_key="$2"

  if [[ "${input_format}" == "key_value_block" ]]; then
    strip_value "$(extract_block_field "${block_key}")"
  else
    strip_value "$(extract_markdown_field "${markdown_label}")"
  fi
}

candidate_profile_name="$(load_value "Candidate profile name" "candidate_profile_name")"
organization_name="$(load_value "Organization name" "organization_name")"
organization_slug="$(load_value "Organization slug" "organization_slug")"
club_name="$(load_value "Club name" "club_name")"
club_slug="$(load_value "Club slug" "club_slug")"
team_name="$(load_value "Team name" "team_name")"
team_slug="$(load_value "Team slug" "team_slug")"
age_group="$(load_value "Age group" "age_group")"

submitter_name="$(load_value "Submitter name" "submitter_name")"
submitter_email="$(load_value "Submitter email" "submitter_email")"
organization_admin_name="$(load_value "Organization admin name" "organization_admin_name")"
organization_admin_email="$(load_value "Organization admin email" "organization_admin_email")"
club_admin_name="$(load_value "Club admin name" "club_admin_name")"
club_admin_email="$(load_value "Club admin email" "club_admin_email")"
reviewer_name="$(load_value "Club comms reviewer name" "reviewer_name")"
reviewer_email="$(load_value "Club comms reviewer email" "reviewer_email")"
team_manager_name="$(load_value "Team manager reviewer name" "team_manager_name")"
team_manager_email="$(load_value "Team manager reviewer email" "team_manager_email")"
allow_agent_routing="$(load_value "Allow Hermes agent routing" "allow_agent_routing")"
auto_approve_internal_low_risk="$(load_value "Auto-approve low-risk internal content at organization level" "auto_approve_internal_low_risk")"
auto_approve_max_risk="$(load_value "Auto-approve max risk threshold" "auto_approve_max_risk")"
auto_approval_content_types="$(load_value "Allowed auto-approval content types" "auto_approval_content_types")"
routing_video_approver_role="$(load_value "Organization routing rule for video" "routing_video_approver_role")"
second_approver_role="$(load_value "Organization second approver role" "second_approver_role")"
second_approval_content_types="$(load_value "Organization second-approval content types" "second_approval_content_types")"
org_notification_email="$(load_value "Organization notification default email" "org_notification_email")"
org_notification_push="$(load_value "Organization notification default push" "org_notification_push")"
default_approver_role="$(load_value "Default approver role" "default_approver_role")"
public_content_approver_role="$(load_value "Public-content approver role" "public_content_approver_role")"
medium_risk_approver_role="$(load_value "Medium-risk approver role" "medium_risk_approver_role")"
inherit_org_defaults="$(load_value "Should the club inherit org defaults unless explicitly noted" "inherit_org_defaults")"
public_second_approval="$(load_value "Public-content second approval required" "public_second_approval")"
club_auto_approve_internal_low_risk="$(load_value "Club effective auto-approve low-risk internal content" "club_auto_approve_internal_low_risk")"
club_routing_video_approver_role="$(load_value "Club effective routing rule for video" "club_routing_video_approver_role")"
club_public_second_approval="$(load_value "Club effective public-content second approval" "club_public_second_approval")"
club_notification_email="$(load_value "Club effective notification baseline email" "club_notification_email")"
club_notification_push="$(load_value "Club effective notification baseline push" "club_notification_push")"

required=(
  candidate_profile_name
  organization_name
  organization_slug
  club_name
  club_slug
  team_name
  team_slug
  age_group
  submitter_name
  submitter_email
  organization_admin_name
  organization_admin_email
  club_admin_name
  club_admin_email
  reviewer_name
  reviewer_email
  team_manager_name
  team_manager_email
)

missing=()
for field_name in "${required[@]}"; do
  field_value="${!field_name:-}"
  if [[ -z "${field_value}" ]]; then
    missing+=("${field_name}")
  fi
done

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "The intake file is missing required fields:" >&2
  printf ' - %s\n' "${missing[@]}" >&2
  exit 1
fi

if [[ ! "${candidate_profile_name}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Candidate profile name must use lowercase letters, numbers, and hyphens only: ${candidate_profile_name}" >&2
  exit 1
fi

output_path="${repo_root}/config/pilot-candidates/${candidate_profile_name}.local.env"
if [[ -e "${output_path}" ]]; then
  echo "Pilot candidate profile already exists: ${output_path}" >&2
  exit 1
fi

cat > "${output_path}" <<EOF
PILOT_CANDIDATE_PROFILE_NAME=${candidate_profile_name}
PILOT_CANDIDATE=${candidate_profile_name//-/_}
PILOT_ORGANIZATION_NAME="${organization_name}"
PILOT_ORGANIZATION_SLUG=${organization_slug}
ORGANIZATION_SLUG=${organization_slug}
PILOT_CLUB_NAME="${club_name}"
PILOT_CLUB_SLUG=${club_slug}
CLUB_SLUG=${club_slug}
PILOT_TEAM_NAME="${team_name}"
PILOT_TEAM_SLUG=${team_slug}
TEAM_SLUG=${team_slug}
PILOT_AGE_GROUP=${age_group}
SUBMITTER_NAME="${submitter_name}"
SUBMITTER_EMAIL=${submitter_email}
ORGANIZATION_ADMIN_NAME="${organization_admin_name}"
ORGANIZATION_ADMIN_EMAIL=${organization_admin_email}
CLUB_ADMIN_NAME="${club_admin_name}"
CLUB_ADMIN_EMAIL=${club_admin_email}
REVIEWER_NAME="${reviewer_name}"
REVIEWER_EMAIL=${reviewer_email}
TEAM_MANAGER_REVIEWER_NAME="${team_manager_name}"
TEAM_MANAGER_REVIEWER_EMAIL=${team_manager_email}
PRIMARY_REVIEWER_NAME="${team_manager_name}"
PRIMARY_REVIEWER_EMAIL=${team_manager_email}
SECOND_REVIEWER_NAME="${club_admin_name}"
SECOND_REVIEWER_EMAIL=${club_admin_email}
PILOT_ORG_DEFAULT_APPROVER_ROLE=${default_approver_role}
PILOT_ORG_PUBLIC_APPROVER_ROLE=${public_content_approver_role}
PILOT_ORG_MEDIUM_RISK_APPROVER_ROLE=${medium_risk_approver_role}
PILOT_ORG_ALLOW_AGENT_ROUTING=${allow_agent_routing}
PILOT_ORG_AUTO_APPROVE_INTERNAL_LOW_RISK=${auto_approve_internal_low_risk}
PILOT_ORG_AUTO_APPROVE_MAX_RISK=${auto_approve_max_risk}
PILOT_ORG_AUTO_APPROVAL_ALLOWED_CONTENT_TYPES="${auto_approval_content_types}"
PILOT_ORG_ROUTING_VIDEO_APPROVER_ROLE=${routing_video_approver_role}
PILOT_ORG_REQUIRE_SECOND_APPROVAL_PUBLIC=${public_second_approval}
PILOT_ORG_SECOND_APPROVER_ROLE=${second_approver_role}
PILOT_ORG_SECOND_APPROVAL_CONTENT_TYPES="${second_approval_content_types}"
PILOT_ORG_NOTIFICATION_EMAIL=${org_notification_email}
PILOT_ORG_NOTIFICATION_PUSH=${org_notification_push}
PILOT_CLUB_POLICY_INHERITS_ORG_DEFAULTS=${inherit_org_defaults}
PILOT_CLUB_OVERRIDE_AUTO_APPROVE_INTERNAL_LOW_RISK=${club_auto_approve_internal_low_risk}
PILOT_CLUB_OVERRIDE_ROUTING_VIDEO_APPROVER_ROLE=${club_routing_video_approver_role}
PILOT_CLUB_OVERRIDE_REQUIRE_SECOND_APPROVAL_PUBLIC=${club_public_second_approval}
PILOT_CLUB_OVERRIDE_NOTIFICATION_EMAIL=${club_notification_email}
PILOT_CLUB_OVERRIDE_NOTIFICATION_PUSH=${club_notification_push}
EOF

echo "created_profile=${output_path}"
echo "source_intake=${intake_path}"
echo "source_format=${input_format}"
echo "inspect_command=npm run pilot:inspect -- ${candidate_profile_name}"
echo "validate_command=PILOT_CANDIDATE_PROFILE=${candidate_profile_name} bash scripts/validate_pilot_candidate_profile.sh"
echo "handoff_packet_command=npm run pilot:handoff-packet -- ${candidate_profile_name}"
echo "creation_plan_command=npm run pilot:create-plan -- ${candidate_profile_name}"
