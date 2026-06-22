#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

intake_path="${PILOT_REAL_CANDIDATE_INTAKE_PATH:-${repo_root}/docs/pilot-real-candidate-intake.md}"
pilot_profile="${PILOT_CANDIDATE_PROFILE:-}"
handoff_packet_path="${PILOT_CANDIDATE_HANDOFF_PACKET_PATH:-${repo_root}/tmp/pilot-candidate-handoff.md}"
creation_output_dir="${PILOT_CANDIDATE_CREATION_OUTPUT_DIR:-${repo_root}/tmp/pilot-candidate-create-plan}"

if [[ $# -gt 0 ]]; then
  if [[ -f "$1" ]]; then
    intake_path="$1"
  else
    pilot_profile="$1"
  fi
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
  if rg -q '^[[:space:]]*candidate_profile_name=' "${intake_path}" 2>/dev/null; then
    echo "key_value_block"
  else
    echo "markdown_intake"
  fi
}

is_yes_no_value() {
  [[ "$1" == "yes" || "$1" == "no" ]]
}

emit_check() {
  local name="$1"
  local status="$2"
  local detail="$3"
  echo "check=${name} status=${status} detail=${detail}"
}

if [[ ! -f "${intake_path}" ]]; then
  emit_check "intake_file" "missing" "${intake_path}"
  echo "pilot_real_candidate_readiness=NO_GO"
  echo "pilot_real_candidate_next_step=fill_intake"
  exit 1
fi

emit_check "intake_file" "ok" "${intake_path}"

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
launch_decision_owner="$(load_value "Launch decision owner" "launch_decision_owner")"
day_one_operator="$(load_value "Day-one operator" "day_one_operator")"
rollback_owner="$(load_value "Rollback owner" "rollback_owner")"
escalation_contact="$(load_value "Escalation contact" "escalation_contact")"
require_email_delivery="$(load_value "Require real email delivery for launch" "require_email_delivery")"
require_push_delivery="$(load_value "Require real push delivery for launch" "require_push_delivery")"
default_approver_role="$(load_value "Default approver role" "default_approver_role")"
public_content_approver_role="$(load_value "Public-content approver role" "public_content_approver_role")"
medium_risk_approver_role="$(load_value "Medium-risk approver role" "medium_risk_approver_role")"
allow_agent_routing="$(load_value "Allow Hermes agent routing" "allow_agent_routing")"
auto_approve_internal_low_risk="$(load_value "Auto-approve low-risk internal content at organization level" "auto_approve_internal_low_risk")"
auto_approve_max_risk="$(load_value "Auto-approve max risk threshold" "auto_approve_max_risk")"
auto_approval_content_types="$(load_value "Allowed auto-approval content types" "auto_approval_content_types")"
routing_video_approver_role="$(load_value "Organization routing rule for video" "routing_video_approver_role")"
inherit_org_defaults="$(load_value "Should the club inherit org defaults unless explicitly noted" "inherit_org_defaults")"
public_second_approval="$(load_value "Public-content second approval required" "public_second_approval")"
second_approver_role="$(load_value "Organization second approver role" "second_approver_role")"
second_approval_content_types="$(load_value "Organization second-approval content types" "second_approval_content_types")"
org_notification_email="$(load_value "Organization notification default email" "org_notification_email")"
org_notification_push="$(load_value "Organization notification default push" "org_notification_push")"
notification_posture="$(load_value "Notification posture on day one" "notification_posture")"
rollback_trigger="$(load_value "Rollback trigger" "rollback_trigger")"
first_override="$(load_value "First override to remove if day-one behavior is wrong" "first_override")"
rollback_scenarios="$(load_value "Scenarios to rerun after rollback" "rollback_scenarios")"
pilot_comms_owner="$(load_value "Pilot-club communication owner" "pilot_comms_owner")"

if [[ -z "${pilot_profile}" && -n "${candidate_profile_name}" ]]; then
  pilot_profile="${candidate_profile_name}"
fi

required_intake_fields=(
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
  launch_decision_owner
  day_one_operator
  rollback_owner
  escalation_contact
  require_email_delivery
  require_push_delivery
  default_approver_role
  public_content_approver_role
  medium_risk_approver_role
  allow_agent_routing
  auto_approve_internal_low_risk
  auto_approve_max_risk
  auto_approval_content_types
  routing_video_approver_role
  inherit_org_defaults
  public_second_approval
  second_approver_role
  second_approval_content_types
  org_notification_email
  org_notification_push
  notification_posture
  rollback_trigger
  first_override
  rollback_scenarios
  pilot_comms_owner
)

missing_intake=()
for field_name in "${required_intake_fields[@]}"; do
  field_value="${!field_name:-}"
  if [[ -z "${field_value}" ]]; then
    missing_intake+=("${field_name}")
  fi
done

for yes_no_field in require_email_delivery require_push_delivery inherit_org_defaults public_second_approval; do
  field_value="${!yes_no_field:-}"
  if ! is_yes_no_value "${field_value}"; then
    missing_intake+=("${yes_no_field}")
  fi
done

if [[ "${#missing_intake[@]}" -gt 1 ]]; then
  deduped_missing=()
  for item in "${missing_intake[@]}"; do
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
  missing_intake=("${deduped_missing[@]}")
fi

if [[ "${#missing_intake[@]}" -gt 0 ]]; then
  emit_check "intake_fields" "missing" "$(IFS=,; echo "${missing_intake[*]}")"
  echo "pilot_real_candidate_profile=${pilot_profile:-unknown}"
  echo "pilot_real_candidate_readiness=NO_GO"
  echo "pilot_real_candidate_next_step=fill_intake"
  for item in "${missing_intake[@]}"; do
    echo "missing_intake=${item}"
  done
  exit 1
fi

emit_check "intake_fields" "ok" "all required readiness fields present"
emit_check "intake_format" "ok" "${input_format}"

source "${script_dir}/load_pilot_candidate_env.sh" "${pilot_profile}"

if [[ -z "${PILOT_CANDIDATE_PROFILE_PATH:-}" ]]; then
  emit_check "candidate_profile" "missing" "${pilot_profile:-unset}"
  echo "pilot_real_candidate_profile=${pilot_profile:-unknown}"
  echo "pilot_real_candidate_readiness=NO_GO"
  echo "pilot_real_candidate_next_step=run_profile_from_intake"
  exit 1
fi

emit_check "candidate_profile" "ok" "${PILOT_CANDIDATE_PROFILE_PATH}"

validate_output_file="$(mktemp)"
cleanup() {
  rm -f "${validate_output_file}"
}
trap cleanup EXIT

if env PILOT_CANDIDATE_PROFILE="${PILOT_CANDIDATE_PROFILE_PATH}" bash "${script_dir}/validate_pilot_candidate_profile.sh" > "${validate_output_file}" 2>&1; then
  emit_check "profile_preflight" "ok" "${PILOT_CANDIDATE_PROFILE_PATH}"
else
  emit_check "profile_preflight" "failed" "${PILOT_CANDIDATE_PROFILE_PATH}"
  cat "${validate_output_file}"
  echo "pilot_real_candidate_profile=${pilot_profile}"
  echo "pilot_real_candidate_profile_path=${PILOT_CANDIDATE_PROFILE_PATH}"
  echo "pilot_real_candidate_readiness=NO_GO"
  echo "pilot_real_candidate_next_step=fix_candidate_profile"
  exit 1
fi

if [[ -f "${handoff_packet_path}" ]] && grep -q "Candidate profile: \`${pilot_profile}\`" "${handoff_packet_path}" && grep -q 'Decision: `GO`' "${handoff_packet_path}"; then
  emit_check "handoff_packet" "ok" "${handoff_packet_path}"
else
  emit_check "handoff_packet" "missing" "${handoff_packet_path}"
  echo "pilot_real_candidate_profile=${pilot_profile}"
  echo "pilot_real_candidate_profile_path=${PILOT_CANDIDATE_PROFILE_PATH}"
  echo "pilot_real_candidate_readiness=NO_GO"
  echo "pilot_real_candidate_next_step=run_handoff_packet"
  exit 1
fi

latest_creation_summary="$(
  find "${creation_output_dir}" -mindepth 2 -maxdepth 2 -type f -name summary.txt -path "*-${pilot_profile}/summary.txt" 2>/dev/null | sort | tail -n 1
)"

if [[ -n "${latest_creation_summary}" ]] && grep -q '^pilot_candidate_creation_decision=GO$' "${latest_creation_summary}"; then
  emit_check "creation_plan" "ok" "${latest_creation_summary}"
else
  emit_check "creation_plan" "missing" "${creation_output_dir}"
  echo "pilot_real_candidate_profile=${pilot_profile}"
  echo "pilot_real_candidate_profile_path=${PILOT_CANDIDATE_PROFILE_PATH}"
  echo "pilot_real_candidate_handoff_packet=${handoff_packet_path}"
  echo "pilot_real_candidate_readiness=NO_GO"
  echo "pilot_real_candidate_next_step=run_creation_plan"
  exit 1
fi

echo "pilot_real_candidate_profile=${pilot_profile}"
echo "pilot_real_candidate_profile_path=${PILOT_CANDIDATE_PROFILE_PATH}"
echo "pilot_real_candidate_handoff_packet=${handoff_packet_path}"
echo "pilot_real_candidate_creation_summary=${latest_creation_summary}"
echo "pilot_real_candidate_readiness=GO"
echo "pilot_real_candidate_next_step=review_sql_and_prepare_hosted_creation"
