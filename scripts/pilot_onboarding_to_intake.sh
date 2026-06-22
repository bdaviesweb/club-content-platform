#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-${PILOT_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-template.md}}"

if [[ ! -f "${onboarding_path}" ]]; then
  echo "Missing onboarding worksheet: ${onboarding_path}" >&2
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

extract_contact_name() {
  local value="$1"
  local normalized
  normalized="$(printf "%s" "${value}" | tr -d '\r' | sed 's/`//g')"
  if [[ "${normalized}" == *"<"*">"* ]]; then
    printf "%s" "$(strip_value "${normalized%%<*}")"
    return
  fi
  printf "%s" "$(strip_value "${normalized}")"
}

extract_contact_email() {
  local value="$1"
  printf "%s" "${value}" | tr -d '\r`' | sed -nE 's/.*<([^>]+)>.*/\1/p' | head -n 1
}

split_team_identity() {
  local value="$1"
  local normalized
  normalized="$(printf "%s" "${value}" | tr -d '\r`')"
  if [[ "${normalized}" == *"/"* ]]; then
    printf '%s\n%s\n' "$(strip_value "${normalized%%/*}")" "$(strip_value "${normalized#*/}")"
    return
  fi
  printf '%s\n%s\n' "$(strip_value "${normalized}")" ""
}

bool_from_assignment() {
  local value="$1"
  local key="$2"
  if [[ "${value}" =~ ${key}=true ]]; then
    printf "yes"
  elif [[ "${value}" =~ ${key}=false ]]; then
    printf "no"
  else
    printf ""
  fi
}

organization_name="$(strip_value "$(extract_field "Organization name")")"
organization_slug="$(strip_value "$(extract_field "Organization slug")")"
club_name="$(strip_value "$(extract_field "Club name")")"
club_slug="$(strip_value "$(extract_field "Club slug")")"
team_identity="$(extract_field "Team names and slugs")"
team_parts_raw="$(split_team_identity "${team_identity}")"
team_name="$(printf "%s\n" "${team_parts_raw}" | sed -n '1p')"
team_slug="$(printf "%s\n" "${team_parts_raw}" | sed -n '2p')"
age_group="$(strip_value "$(extract_field "Age group")")"
candidate_profile_name="$(strip_value "$(extract_field "Candidate profile name")")"
if [[ -z "${candidate_profile_name}" && -n "${club_slug}" ]]; then
  candidate_profile_name="${club_slug}-pilot"
fi

submitter_value="$(extract_field "Submitter name and email")"
organization_admin_value="$(extract_field "Organization admin name and email")"
club_admin_value="$(extract_field "Club admin name and email")"
reviewer_value="$(extract_field "Club comms reviewer name and email")"
team_manager_value="$(extract_field "Team manager reviewer name and email")"
launch_decision_owner="$(strip_value "$(extract_field "Launch decision owner")")"
day_one_operator="$(strip_value "$(extract_field "Day-one operator")")"
rollback_owner="$(strip_value "$(extract_field "Rollback owner")")"
escalation_value="$(extract_field "Escalation contact")"

submitter_name="$(extract_contact_name "${submitter_value}")"
submitter_email="$(extract_contact_email "${submitter_value}")"
organization_admin_name="$(extract_contact_name "${organization_admin_value}")"
organization_admin_email="$(extract_contact_email "${organization_admin_value}")"
club_admin_name="$(extract_contact_name "${club_admin_value}")"
club_admin_email="$(extract_contact_email "${club_admin_value}")"
reviewer_name="$(extract_contact_name "${reviewer_value}")"
reviewer_email="$(extract_contact_email "${reviewer_value}")"
team_manager_name="$(extract_contact_name "${team_manager_value}")"
team_manager_email="$(extract_contact_email "${team_manager_value}")"
escalation_contact="$(extract_contact_email "${escalation_value}")"
if [[ -z "${escalation_contact}" ]]; then
  escalation_contact="$(extract_contact_name "${escalation_value}")"
fi

default_approver_role="$(strip_value "$(extract_field "Default approver role")")"
public_content_approver_role="$(strip_value "$(extract_field "Public-content approver role")")"
medium_risk_approver_role="$(strip_value "$(extract_field "Medium-risk approver role")")"
allow_agent_routing="$(strip_value "$(extract_field "Allow Hermes agent routing")")"
auto_approve_internal_low_risk="$(strip_value "$(extract_field "Auto-approve low-risk internal content at organization level")")"
auto_approve_max_risk="$(strip_value "$(extract_field "Auto-approve max risk threshold")")"
auto_approval_content_types="$(strip_value "$(extract_field "Allowed auto-approval content types")")"
routing_video_approver_role="$(strip_value "$(extract_field "Organization routing rule for \`video\`")")"
if [[ -z "${routing_video_approver_role}" ]]; then
  routing_video_approver_role="$(strip_value "$(extract_field "Organization routing rule for video")")"
fi
inherit_org_defaults="$(strip_value "$(extract_field "Should the club inherit org defaults unless explicitly noted")")"
public_second_approval="$(strip_value "$(extract_field "Organization public-content second approval")")"
if [[ -z "${public_second_approval}" ]]; then
  public_second_approval="$(strip_value "$(extract_field "Require second approval for public content")")"
fi
second_approver_role="$(strip_value "$(extract_field "Organization second approver role")")"
if [[ -z "${second_approver_role}" ]]; then
  second_approver_role="$(strip_value "$(extract_field "Second approver role")")"
fi
second_approval_content_types="$(strip_value "$(extract_field "Organization second-approval content types")")"
if [[ -z "${second_approval_content_types}" ]]; then
  second_approval_content_types="$(strip_value "$(extract_field "Second-approval content types")")"
fi
club_auto_approve_internal_low_risk="$(strip_value "$(extract_field "Auto-approve low-risk internal content at club effective level")")"
club_routing_video_approver_role="$(strip_value "$(extract_field "Club effective routing rule for \`video\`")")"
if [[ -z "${club_routing_video_approver_role}" ]]; then
  club_routing_video_approver_role="$(strip_value "$(extract_field "Club effective routing rule for video")")"
fi
club_public_second_approval="$(strip_value "$(extract_field "Club effective public-content second approval")")"

organization_notification_default="$(extract_field "Organization notification default")"
org_notification_email="$(bool_from_assignment "${organization_notification_default}" "email")"
org_notification_push="$(bool_from_assignment "${organization_notification_default}" "push")"

club_notification_baseline="$(extract_field "Club effective notification baseline")"
if [[ -z "${club_notification_baseline}" ]]; then
  club_notification_baseline="$(extract_field "Club effective notification posture")"
fi
club_notification_email="$(bool_from_assignment "${club_notification_baseline}" "email")"
club_notification_push="$(bool_from_assignment "${club_notification_baseline}" "push")"

require_email_delivery="$(strip_value "$(extract_field "Require real email delivery for launch")")"
require_push_delivery="$(strip_value "$(extract_field "Require real push delivery for launch")")"
notification_posture="$(strip_value "$(extract_field "Notification posture on day one")")"
if [[ -z "${notification_posture}" ]]; then
  notification_posture="$(strip_value "$(extract_field "Known delivery limitations or accepted gaps")")"
fi
rollback_trigger="$(strip_value "$(extract_field "Rollback trigger")")"
first_override="$(strip_value "$(extract_field "First override to remove if pilot behavior is wrong")")"
if [[ -z "${first_override}" ]]; then
  first_override="$(strip_value "$(extract_field "First override to remove if day-one behavior is wrong")")"
fi
rollback_scenarios="$(strip_value "$(extract_field "Scenarios to rerun after rollback")")"
pilot_comms_owner="$(strip_value "$(extract_field "Pilot-club communication owner")")"

printf 'candidate_profile_name=%s\n' "${candidate_profile_name}"
printf 'organization_name=%s\n' "${organization_name}"
printf 'organization_slug=%s\n' "${organization_slug}"
printf 'club_name=%s\n' "${club_name}"
printf 'club_slug=%s\n' "${club_slug}"
printf 'team_name=%s\n' "${team_name}"
printf 'team_slug=%s\n' "${team_slug}"
printf 'age_group=%s\n' "${age_group}"
printf '\n'
printf 'submitter_name=%s\n' "${submitter_name}"
printf 'submitter_email=%s\n' "${submitter_email}"
printf '\n'
printf 'organization_admin_name=%s\n' "${organization_admin_name}"
printf 'organization_admin_email=%s\n' "${organization_admin_email}"
printf '\n'
printf 'club_admin_name=%s\n' "${club_admin_name}"
printf 'club_admin_email=%s\n' "${club_admin_email}"
printf '\n'
printf 'reviewer_name=%s\n' "${reviewer_name}"
printf 'reviewer_email=%s\n' "${reviewer_email}"
printf '\n'
printf 'team_manager_name=%s\n' "${team_manager_name}"
printf 'team_manager_email=%s\n' "${team_manager_email}"
printf '\n'
printf 'launch_decision_owner=%s\n' "${launch_decision_owner}"
printf 'day_one_operator=%s\n' "${day_one_operator}"
printf 'rollback_owner=%s\n' "${rollback_owner}"
printf 'escalation_contact=%s\n' "${escalation_contact}"
printf '\n'
printf 'require_email_delivery=%s\n' "${require_email_delivery}"
printf 'require_push_delivery=%s\n' "${require_push_delivery}"
printf 'default_approver_role=%s\n' "${default_approver_role}"
printf 'public_content_approver_role=%s\n' "${public_content_approver_role}"
printf 'medium_risk_approver_role=%s\n' "${medium_risk_approver_role}"
printf 'allow_agent_routing=%s\n' "${allow_agent_routing}"
printf 'auto_approve_internal_low_risk=%s\n' "${auto_approve_internal_low_risk}"
printf 'auto_approve_max_risk=%s\n' "${auto_approve_max_risk}"
printf 'auto_approval_content_types=%s\n' "${auto_approval_content_types}"
printf 'routing_video_approver_role=%s\n' "${routing_video_approver_role}"
printf 'inherit_org_defaults=%s\n' "${inherit_org_defaults}"
printf 'public_second_approval=%s\n' "${public_second_approval}"
printf 'second_approver_role=%s\n' "${second_approver_role}"
printf 'second_approval_content_types=%s\n' "${second_approval_content_types}"
printf 'org_notification_email=%s\n' "${org_notification_email}"
printf 'org_notification_push=%s\n' "${org_notification_push}"
printf 'club_auto_approve_internal_low_risk=%s\n' "${club_auto_approve_internal_low_risk}"
printf 'club_routing_video_approver_role=%s\n' "${club_routing_video_approver_role}"
printf 'club_public_second_approval=%s\n' "${club_public_second_approval}"
printf 'club_notification_email=%s\n' "${club_notification_email}"
printf 'club_notification_push=%s\n' "${club_notification_push}"
printf 'notification_posture=%s\n' "${notification_posture}"
printf 'rollback_trigger=%s\n' "${rollback_trigger}"
printf 'first_override=%s\n' "${first_override}"
printf 'rollback_scenarios=%s\n' "${rollback_scenarios}"
printf 'pilot_comms_owner=%s\n' "${pilot_comms_owner}"
