#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

onboarding_path="${1:-${PILOT_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-template.md}}"

if [[ ! -f "${onboarding_path}" ]]; then
  echo "check=launch_readiness status=missing detail=${onboarding_path}"
  echo "pilot_launch_readiness=NO_GO"
  echo "pilot_launch_readiness_next_step=fill_onboarding"
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

normalize_value() {
  strip_value "$1" | tr '[:upper:]' '[:lower:]'
}

is_complete_status() {
  case "$(normalize_value "$1")" in
    yes|y|complete|completed|pass|passed|done|go) return 0 ;;
    *) return 1 ;;
  esac
}

is_clear_status() {
  case "$(normalize_value "$1")" in
    none|no|n/a|na|clear|cleared) return 0 ;;
    *) return 1 ;;
  esac
}

readiness_fields=(
  "Executive sponsor|executive_sponsor"
  "Day-to-day club lead|day_to_day_club_lead"
  "Internal destinations|internal_destinations"
  "Public destinations|public_destinations"
  "Go-live owner signoff|go_live_owner_signoff"
)

completion_fields=(
  "Operator demo completed|operator_demo_completed"
  "Mobile review smoke completed|mobile_review_smoke_completed"
  "Pilot VPS scenario suite completed|pilot_vps_scenario_suite_completed"
)

issues=()

for entry in "${readiness_fields[@]}"; do
  label="${entry%%|*}"
  key="${entry##*|}"
  value="$(strip_value "$(extract_field "${label}")")"
  if [[ -z "${value}" ]]; then
    issues+=("${key}|${label}|missing")
  fi
done

for entry in "${completion_fields[@]}"; do
  label="${entry%%|*}"
  key="${entry##*|}"
  value="$(strip_value "$(extract_field "${label}")")"
  if ! is_complete_status "${value}"; then
    issues+=("${key}|${label}|expected completed/yes")
  fi
done

open_rollout_blockers="$(strip_value "$(extract_field "Open rollout blockers")")"
if ! is_clear_status "${open_rollout_blockers}"; then
  issues+=("open_rollout_blockers|Open rollout blockers|expected none/clear")
fi

if [[ "${#issues[@]}" -gt 0 ]]; then
  details=()
  for issue in "${issues[@]}"; do
    details+=("${issue%%|*}")
  done
  echo "check=launch_readiness status=blocked detail=$(IFS=,; echo "${details[*]}")"
  echo "pilot_launch_readiness=NO_GO"
  echo "pilot_launch_readiness_next_step=finish_prelaunch_checklist"
  for issue in "${issues[@]}"; do
    key="${issue%%|*}"
    rest="${issue#*|}"
    label="${rest%%|*}"
    expected="${rest##*|}"
    echo "launch_readiness_issue=${key}"
    echo "launch_readiness_issue_label=${label}"
    echo "launch_readiness_issue_expected=${expected}"
  done
  exit 1
fi

echo "check=launch_readiness status=ok detail=prelaunch evidence and signoff recorded"
echo "pilot_launch_readiness=GO"
echo "pilot_launch_readiness_next_step=apply_create_sql"
