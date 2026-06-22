#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-${PILOT_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-template.md}}"

if [[ ! -f "${onboarding_path}" ]]; then
  echo "check=onboarding_file status=missing detail=${onboarding_path}"
  echo "pilot_onboarding_validation=NO_GO"
  echo "pilot_onboarding_next_step=fill_onboarding"
  exit 1
fi

extract_field() {
  local label="$1"
  awk -v label="$label" '
    index($0, "- " label ":") == 1 {
      sub("^- " label ": ?", "", $0)
      print $0
      exit
    }
  ' "${onboarding_path}"
}

strip_value() {
  printf "%s" "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^`//; s/`$//'
}

candidate_profile_name="$(strip_value "$(extract_field "Candidate profile name")")"
organization_name="$(strip_value "$(extract_field "Organization name")")"
organization_slug="$(strip_value "$(extract_field "Organization slug")")"
club_name="$(strip_value "$(extract_field "Club name")")"
club_slug="$(strip_value "$(extract_field "Club slug")")"
team_names_and_slugs="$(strip_value "$(extract_field "Team names and slugs")")"
age_group="$(strip_value "$(extract_field "Age group")")"
launch_decision_owner="$(strip_value "$(extract_field "Launch decision owner")")"
day_one_operator="$(strip_value "$(extract_field "Day-one operator")")"
escalation_contact="$(strip_value "$(extract_field "Escalation contact")")"
submitter_identity="$(strip_value "$(extract_field "Submitter name and email")")"
organization_admin_identity="$(strip_value "$(extract_field "Organization admin name and email")")"
club_admin_identity="$(strip_value "$(extract_field "Club admin name and email")")"
reviewer_identity="$(strip_value "$(extract_field "Club comms reviewer name and email")")"
team_manager_identity="$(strip_value "$(extract_field "Team manager reviewer name and email")")"
default_approver_role="$(strip_value "$(extract_field "Default approver role")")"
public_content_approver_role="$(strip_value "$(extract_field "Public-content approver role")")"
medium_risk_approver_role="$(strip_value "$(extract_field "Medium-risk approver role")")"
allow_agent_routing="$(strip_value "$(extract_field "Allow Hermes agent routing")")"
auto_approve_internal_low_risk_org="$(strip_value "$(extract_field "Auto-approve low-risk internal content at organization level")")"
auto_approve_internal_low_risk_club="$(strip_value "$(extract_field "Auto-approve low-risk internal content at club effective level")")"
auto_approve_max_risk="$(strip_value "$(extract_field "Auto-approve max risk threshold")")"
auto_approval_content_types="$(strip_value "$(extract_field "Allowed auto-approval content types")")"
inherit_org_defaults="$(strip_value "$(extract_field "Should the club inherit org defaults unless explicitly noted")")"
org_routing_video="$(strip_value "$(extract_field "Organization routing rule for \`video\`")")"
club_routing_video="$(strip_value "$(extract_field "Club effective routing rule for \`video\`")")"
org_public_second_approval="$(strip_value "$(extract_field "Organization public-content second approval")")"
org_second_approver_role="$(strip_value "$(extract_field "Organization second approver role")")"
org_second_approval_types="$(strip_value "$(extract_field "Organization second-approval content types")")"
club_public_second_approval="$(strip_value "$(extract_field "Club effective public-content second approval")")"
require_email_delivery="$(strip_value "$(extract_field "Require real email delivery for launch")")"
require_push_delivery="$(strip_value "$(extract_field "Require real push delivery for launch")")"
organization_notification_default="$(strip_value "$(extract_field "Organization notification default")")"
club_notification_baseline="$(strip_value "$(extract_field "Club effective notification baseline")")"
notification_posture="$(strip_value "$(extract_field "Notification posture on day one")")"
rollback_owner="$(strip_value "$(extract_field "Rollback owner")")"
rollback_trigger="$(strip_value "$(extract_field "Rollback trigger")")"
first_override="$(strip_value "$(extract_field "First override to remove if pilot behavior is wrong")")"
rollback_scenarios="$(strip_value "$(extract_field "Scenarios to rerun after rollback")")"
pilot_comms_owner="$(strip_value "$(extract_field "Pilot-club communication owner")")"

required_fields=(
  candidate_profile_name
  organization_name
  organization_slug
  club_name
  club_slug
  team_names_and_slugs
  age_group
  launch_decision_owner
  day_one_operator
  escalation_contact
  submitter_identity
  organization_admin_identity
  club_admin_identity
  reviewer_identity
  team_manager_identity
  default_approver_role
  public_content_approver_role
  medium_risk_approver_role
  allow_agent_routing
  auto_approve_internal_low_risk_org
  auto_approve_internal_low_risk_club
  auto_approve_max_risk
  auto_approval_content_types
  inherit_org_defaults
  org_routing_video
  club_routing_video
  org_public_second_approval
  org_second_approver_role
  org_second_approval_types
  club_public_second_approval
  require_email_delivery
  require_push_delivery
  organization_notification_default
  club_notification_baseline
  notification_posture
  rollback_owner
  rollback_trigger
  first_override
  rollback_scenarios
  pilot_comms_owner
)

missing=()
for field_name in "${required_fields[@]}"; do
  if [[ -z "${!field_name:-}" ]]; then
    missing+=("${field_name}")
  fi
done

for yes_no_field in allow_agent_routing auto_approve_internal_low_risk_org auto_approve_internal_low_risk_club inherit_org_defaults org_public_second_approval club_public_second_approval require_email_delivery require_push_delivery; do
  value="${!yes_no_field:-}"
  if [[ "${value}" != "yes" && "${value}" != "no" ]]; then
    missing+=("${yes_no_field}")
  fi
done

if [[ "${#missing[@]}" -gt 1 ]]; then
  deduped_missing=()
  for item in "${missing[@]}"; do
    already_seen=0
    for seen_item in ${deduped_missing[@]+"${deduped_missing[@]}"}; do
      if [[ "${seen_item}" == "${item}" ]]; then
        already_seen=1
        break
      fi
    done
    if [[ "${already_seen}" == "0" ]]; then
      deduped_missing+=("${item}")
    fi
  done
  missing=("${deduped_missing[@]}")
fi

if [[ -n "${auto_approve_max_risk}" ]] && [[ ! "${auto_approve_max_risk}" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "check=onboarding_numeric status=invalid detail=auto_approve_max_risk"
  echo "pilot_onboarding_validation=NO_GO"
  echo "pilot_onboarding_next_step=fix_onboarding"
  exit 1
fi

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "check=onboarding_fields status=missing detail=$(IFS=,; echo "${missing[*]}")"
  echo "pilot_onboarding_validation=NO_GO"
  echo "pilot_onboarding_next_step=fill_onboarding"
  for item in "${missing[@]}"; do
    echo "missing_onboarding=${item}"
  done
  exit 1
fi

echo "check=onboarding_fields status=ok detail=all required onboarding fields present"
echo "pilot_onboarding_validation=GO"
echo "pilot_onboarding_next_step=prepare_from_onboarding"
