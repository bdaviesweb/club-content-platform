#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-${PILOT_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-template.md}}"

if [[ ! -f "${onboarding_path}" ]]; then
  echo "check=onboarding_gap_report status=missing detail=${onboarding_path}"
  echo "pilot_real_onboarding_gaps=NO_GO"
  echo "pilot_real_onboarding_gap_count=1"
  echo "pilot_real_onboarding_next_step=provide_onboarding_file"
  exit 1
fi

category_for_key() {
  case "$1" in
    candidate_profile_name|organization_name|organization_slug|club_name|club_slug|team_names_and_slugs|age_group)
      printf '%s' "Candidate identity"
      ;;
    launch_decision_owner|day_one_operator|escalation_contact|submitter_identity|organization_admin_identity|club_admin_identity|reviewer_identity|team_manager_identity|executive_sponsor|day_to_day_club_lead)
      printf '%s' "People and ownership"
      ;;
    require_email_delivery|require_push_delivery|organization_notification_default|club_notification_baseline|notification_posture|internal_destinations|public_destinations)
      printf '%s' "Delivery and destinations"
      ;;
    rollback_owner|rollback_trigger|first_override|rollback_scenarios|pilot_comms_owner)
      printf '%s' "Rollback"
      ;;
    go_live_owner_signoff|operator_demo_completed|mobile_review_smoke_completed|pilot_vps_scenario_suite_completed|open_rollout_blockers)
      printf '%s' "Launch evidence"
      ;;
    *)
      printf '%s' "Workflow policy"
      ;;
  esac
}

friendly_issue_label() {
  case "$1" in
    executive_sponsor) printf '%s' "Executive sponsor" ;;
    day_to_day_club_lead) printf '%s' "Day-to-day club lead" ;;
    internal_destinations) printf '%s' "Internal destinations" ;;
    public_destinations) printf '%s' "Public destinations" ;;
    go_live_owner_signoff) printf '%s' "Go-live owner signoff" ;;
    operator_demo_completed) printf '%s' "Operator demo completed" ;;
    mobile_review_smoke_completed) printf '%s' "Mobile review smoke completed" ;;
    pilot_vps_scenario_suite_completed) printf '%s' "Pilot VPS scenario suite completed" ;;
    open_rollout_blockers) printf '%s' "Open rollout blockers" ;;
    *) printf '%s' "$1" ;;
  esac
}

set +e
validation_output="$(
  bash "${script_dir}/pilot_validate_onboarding.sh" "${onboarding_path}"
)"
validation_status=$?

launch_readiness_output="$(
  bash "${script_dir}/pilot_check_launch_readiness.sh" "${onboarding_path}"
)"
launch_readiness_status=$?
set -e

declare -a gap_lines=()
declare -a seen_keys=()

has_seen_key() {
  local key="$1"
  local item
  for item in "${seen_keys[@]:-}"; do
    if [[ "${item}" == "${key}" ]]; then
      return 0
    fi
  done
  return 1
}

while IFS= read -r line; do
  [[ "${line}" == missing_onboarding=* ]] || continue
  key="${line#missing_onboarding=}"
  [[ -n "${key}" ]] || continue
  has_seen_key "${key}" && continue
  seen_keys+=("${key}")
  category="$(category_for_key "$key")"
  gap_lines+=("${category}|$(printf '%s' "${validation_output}" | sed -n "/^missing_onboarding=${key}$/,/^missing_onboarding_label=/p" | sed -n 's/^missing_onboarding_label=//p' | tail -n 1)|fill required worksheet field")
done <<< "${validation_output}"

while IFS= read -r line; do
  [[ "${line}" == launch_readiness_issue=* ]] || continue
  key="${line#launch_readiness_issue=}"
  [[ -n "${key}" ]] || continue
  has_seen_key "${key}" && continue
  seen_keys+=("${key}")
  category="$(category_for_key "$key")"
  label="$(printf '%s' "${launch_readiness_output}" | sed -n "/^launch_readiness_issue=${key}$/,/^launch_readiness_issue_label=/p" | sed -n 's/^launch_readiness_issue_label=//p' | tail -n 1)"
  expected="$(printf '%s' "${launch_readiness_output}" | sed -n "/^launch_readiness_issue=${key}$/,/^launch_readiness_issue_expected=/p" | sed -n 's/^launch_readiness_issue_expected=//p' | tail -n 1)"
  if [[ -z "${label}" ]]; then
    label="$(friendly_issue_label "$key")"
  fi
  if [[ -z "${expected}" ]]; then
    expected="complete required launch evidence"
  fi
  gap_lines+=("${category}|${label}|${expected}")
done <<< "${launch_readiness_output}"

gap_count="${#gap_lines[@]}"

if [[ "${gap_count}" -eq 0 && "${validation_status}" -eq 0 && "${launch_readiness_status}" -eq 0 ]]; then
  echo "check=onboarding_gap_report status=ok detail=no remaining worksheet gaps"
  echo "pilot_real_onboarding_gaps=GO"
  echo "pilot_real_onboarding_gap_count=0"
  echo "pilot_real_onboarding_next_step=launch_from_onboarding"
  exit 0
fi

echo "check=onboarding_gap_report status=blocked detail=${gap_count} remaining gaps"
echo "pilot_real_onboarding_gaps=NO_GO"
echo "pilot_real_onboarding_gap_count=${gap_count}"
echo "pilot_real_onboarding_next_step=fill_real_fields"

for gap in "${gap_lines[@]}"; do
  category="${gap%%|*}"
  rest="${gap#*|}"
  label="${rest%%|*}"
  action="${rest##*|}"
  echo "pilot_real_onboarding_gap_category=${category}"
  echo "pilot_real_onboarding_gap_label=${label}"
  echo "pilot_real_onboarding_gap_action=${action}"
done

exit 1
