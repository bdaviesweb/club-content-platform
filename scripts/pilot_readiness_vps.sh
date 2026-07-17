#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/load_pilot_candidate_env.sh" "${PILOT_CANDIDATE_PROFILE:-}"

SCENARIOS_INPUT="${PILOT_SCENARIOS:-review_publish,auto_approval_override,approval_override,notification_override}"
DRY_RUN="${DRY_RUN:-0}"

scenario_script_path() {
  case "$1" in
    review_publish) printf '%s\n' "scripts/approval_publish_smoke_vps.sh" ;;
    auto_approval_override) printf '%s\n' "scripts/auto_approval_override_smoke_vps.sh" ;;
    approval_override) printf '%s\n' "scripts/approval_override_smoke_vps.sh" ;;
    notification_override) printf '%s\n' "scripts/event_notification_rule_smoke_vps.sh" ;;
    *) return 1 ;;
  esac
}

scenario_description() {
  case "$1" in
    review_publish) printf '%s\n' "Human review to publish baseline" ;;
    auto_approval_override) printf '%s\n' "Organization default auto-approval with club override fallback" ;;
    approval_override) printf '%s\n' "Organization second approval with club override bypass" ;;
    notification_override) printf '%s\n' "Organization notification defaults with club override replacement" ;;
    *) return 1 ;;
  esac
}

allowed_scenarios() {
  printf '%s\n' "review_publish auto_approval_override approval_override notification_override"
}

SCENARIOS=()
IFS=',' read -r -a raw_scenarios <<< "${SCENARIOS_INPUT}"
for raw_scenario in "${raw_scenarios[@]}"; do
  scenario="$(printf '%s' "${raw_scenario}" | tr -d '[:space:]')"
  [[ -n "${scenario}" ]] || continue

  if ! scenario_script_path "${scenario}" >/dev/null; then
    echo "Unknown pilot scenario: ${scenario}" >&2
    echo "Allowed scenarios: $(allowed_scenarios)" >&2
    exit 1
  fi

  SCENARIOS+=("${scenario}")
done

if [[ "${#SCENARIOS[@]}" -eq 0 ]]; then
  echo "No pilot scenarios selected." >&2
  exit 1
fi

echo "Pilot readiness scenario suite"
if [[ -n "${PILOT_CANDIDATE_PROFILE:-}" ]]; then
  echo "Pilot candidate profile: ${PILOT_CANDIDATE_PROFILE}"
fi
if [[ -n "${PILOT_ORGANIZATION_SLUG:-}" ]]; then
  echo "Pilot organization: ${PILOT_ORGANIZATION_SLUG}"
fi
if [[ -n "${PILOT_CLUB_SLUG:-${CLUB_SLUG:-}}" ]]; then
  echo "Pilot club: ${PILOT_CLUB_SLUG:-${CLUB_SLUG:-}}"
fi
echo "Selected scenarios: ${SCENARIOS[*]}"

run_scenario() {
  local scenario="$1"
  local script_path
  local description

  script_path="$(scenario_script_path "${scenario}")"
  description="$(scenario_description "${scenario}")"

  echo
  echo "==> ${scenario}: ${description}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "DRY_RUN ${script_path}"
    return 0
  fi

  bash "${script_path}"
}

for scenario in "${SCENARIOS[@]}"; do
  run_scenario "${scenario}"
done

echo
echo "Pilot readiness scenario suite passed."
