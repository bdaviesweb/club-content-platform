#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-}"
reply_template_path="${2:-}"
output_onboarding_path="${3:-}"

if [[ -z "${onboarding_path}" || -z "${reply_template_path}" ]]; then
  echo "Usage: bash scripts/pilot_apply_reply_template.sh /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt [/absolute/path/to/output-onboarding.md]" >&2
  exit 1
fi

if [[ ! -f "${onboarding_path}" ]]; then
  echo "Missing onboarding worksheet: ${onboarding_path}" >&2
  exit 1
fi

if [[ ! -f "${reply_template_path}" ]]; then
  echo "Missing reply template: ${reply_template_path}" >&2
  exit 1
fi

if [[ -z "${output_onboarding_path}" ]]; then
  output_onboarding_path="${onboarding_path}"
fi

extract_template_field() {
  local label="$1"
  awk -v label="$label" '
    index($0, "- " label ":") == 1 {
      sub("^- " label ": ?", "", $0)
      print $0
      exit
    }
  ' "${reply_template_path}"
}

strip_value() {
  printf "%s" "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^`//; s/`$//'
}

update_field() {
  local file_path="$1"
  local label="$2"
  local value="$3"
  local temp_path

  if [[ -z "${value}" ]]; then
    return
  fi

  temp_path="$(mktemp)"
  awk -v label="$label" -v value="$value" '
    index($0, "- " label ":") == 1 {
      print "- " label ": " value
      next
    }
    { print }
  ' "${file_path}" > "${temp_path}"
  mv "${temp_path}" "${file_path}"
}

join_non_empty() {
  local separator="$1"
  shift
  local joined=""
  local item

  for item in "$@"; do
    if [[ -z "${item}" ]]; then
      continue
    fi
    if [[ -n "${joined}" ]]; then
      joined="${joined}${separator}${item}"
    else
      joined="${item}"
    fi
  done

  printf '%s' "${joined}"
}

candidate_profile_name="$(strip_value "$(extract_template_field "Candidate profile name")")"
organization_name="$(strip_value "$(extract_template_field "Organization name")")"
organization_slug="$(strip_value "$(extract_template_field "Organization slug")")"
club_name="$(strip_value "$(extract_template_field "Club name")")"
club_slug="$(strip_value "$(extract_template_field "Club slug")")"
team_names_and_slugs="$(strip_value "$(extract_template_field "Team names and slugs")")"
age_group="$(strip_value "$(extract_template_field "Age group")")"

executive_sponsor="$(strip_value "$(extract_template_field "Executive sponsor")")"
day_to_day_club_lead="$(strip_value "$(extract_template_field "Day-to-day club lead")")"
launch_decision_owner="$(strip_value "$(extract_template_field "Launch decision owner")")"
day_one_operator="$(strip_value "$(extract_template_field "Day-one operator")")"
escalation_contact="$(strip_value "$(extract_template_field "Escalation contact")")"
submitter_identity="$(strip_value "$(extract_template_field "Submitter name and email")")"
organization_admin_identity="$(strip_value "$(extract_template_field "Organization admin name and email")")"
club_admin_identity="$(strip_value "$(extract_template_field "Club admin name and email")")"
reviewer_identity="$(strip_value "$(extract_template_field "Club comms reviewer name and email")")"
team_manager_identity="$(strip_value "$(extract_template_field "Team manager reviewer name and email")")"

require_email_delivery="$(strip_value "$(extract_template_field "Require real email delivery for launch")")"
require_push_delivery="$(strip_value "$(extract_template_field "Require real push delivery for launch")")"
notification_posture="$(strip_value "$(extract_template_field "Notification posture on day one")")"

rollback_owner="$(strip_value "$(extract_template_field "Rollback owner")")"
rollback_trigger="$(strip_value "$(extract_template_field "Rollback trigger")")"
first_override="$(strip_value "$(extract_template_field "First override to remove if pilot behavior is wrong")")"
rollback_scenarios="$(strip_value "$(extract_template_field "Scenarios to rerun after rollback")")"
pilot_comms_owner="$(strip_value "$(extract_template_field "Pilot-club communication owner")")"

go_live_owner_signoff="$(strip_value "$(extract_template_field "Go-live owner signoff")")"
operator_demo_completed="$(strip_value "$(extract_template_field "Operator demo completed")")"
mobile_review_smoke_completed="$(strip_value "$(extract_template_field "Mobile review smoke completed")")"
pilot_vps_scenario_suite_completed="$(strip_value "$(extract_template_field "Pilot VPS scenario suite completed")")"
open_rollout_blockers="$(strip_value "$(extract_template_field "Open rollout blockers")")"

mkdir -p "$(dirname "${output_onboarding_path}")"
if [[ "${onboarding_path}" != "${output_onboarding_path}" ]]; then
  cp "${onboarding_path}" "${output_onboarding_path}"
fi

reviewer_accounts="$(join_non_empty "; " "${organization_admin_identity}" "${club_admin_identity}" "${reviewer_identity}" "${team_manager_identity}")"

update_field "${output_onboarding_path}" "Candidate profile name" "${candidate_profile_name}"
update_field "${output_onboarding_path}" "Organization name" "${organization_name}"
update_field "${output_onboarding_path}" "Organization slug" "${organization_slug}"
update_field "${output_onboarding_path}" "Club name" "${club_name}"
update_field "${output_onboarding_path}" "Club slug" "${club_slug}"
update_field "${output_onboarding_path}" "Team names and slugs" "${team_names_and_slugs}"
update_field "${output_onboarding_path}" "Age group" "${age_group}"

update_field "${output_onboarding_path}" "Executive sponsor" "${executive_sponsor}"
update_field "${output_onboarding_path}" "Day-to-day club lead" "${day_to_day_club_lead}"
update_field "${output_onboarding_path}" "Launch decision owner" "${launch_decision_owner}"
update_field "${output_onboarding_path}" "Day-one operator" "${day_one_operator}"
update_field "${output_onboarding_path}" "Submitter accounts" "${submitter_identity}"
update_field "${output_onboarding_path}" "Reviewer accounts" "${reviewer_accounts}"
update_field "${output_onboarding_path}" "Escalation contact" "${escalation_contact}"

update_field "${output_onboarding_path}" "\`organization_admin\`" "${organization_admin_identity}"
update_field "${output_onboarding_path}" "\`team_manager\`" "${team_manager_identity}"
update_field "${output_onboarding_path}" "\`club_comms\`" "${reviewer_identity}"
update_field "${output_onboarding_path}" "\`club_admin\`" "${club_admin_identity}"

update_field "${output_onboarding_path}" "Submitter name and email" "${submitter_identity}"
update_field "${output_onboarding_path}" "Organization admin name and email" "${organization_admin_identity}"
update_field "${output_onboarding_path}" "Club admin name and email" "${club_admin_identity}"
update_field "${output_onboarding_path}" "Club comms reviewer name and email" "${reviewer_identity}"
update_field "${output_onboarding_path}" "Team manager reviewer name and email" "${team_manager_identity}"

update_field "${output_onboarding_path}" "Require real email delivery for launch" "${require_email_delivery}"
update_field "${output_onboarding_path}" "Require real push delivery for launch" "${require_push_delivery}"
update_field "${output_onboarding_path}" "Notification posture on day one" "${notification_posture}"

update_field "${output_onboarding_path}" "Operator demo completed" "${operator_demo_completed}"
update_field "${output_onboarding_path}" "Mobile review smoke completed" "${mobile_review_smoke_completed}"
update_field "${output_onboarding_path}" "Pilot VPS scenario suite completed" "${pilot_vps_scenario_suite_completed}"
update_field "${output_onboarding_path}" "Open rollout blockers" "${open_rollout_blockers}"
update_field "${output_onboarding_path}" "Go-live owner signoff" "${go_live_owner_signoff}"

update_field "${output_onboarding_path}" "Rollback owner" "${rollback_owner}"
update_field "${output_onboarding_path}" "Rollback trigger" "${rollback_trigger}"
update_field "${output_onboarding_path}" "First override to remove if pilot behavior is wrong" "${first_override}"
update_field "${output_onboarding_path}" "Scenarios to rerun after rollback" "${rollback_scenarios}"
update_field "${output_onboarding_path}" "Pilot-club communication owner" "${pilot_comms_owner}"

echo "pilot_reply_template_source=${reply_template_path}"
echo "pilot_reply_template_onboarding=${onboarding_path}"
echo "pilot_reply_template_output=${output_onboarding_path}"
echo "pilot_reply_template_next_step=validate_onboarding"
