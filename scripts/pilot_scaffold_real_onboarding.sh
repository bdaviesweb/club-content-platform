#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

source_onboarding_path="${1:-${PILOT_SOURCE_ONBOARDING_PATH:-${repo_root}/docs/pilot-onboarding-north-river-youth-sports.md}}"
output_onboarding_path="${2:-${PILOT_SCAFFOLD_ONBOARDING_OUTPUT_PATH:-${repo_root}/tmp/pilot-onboarding-real-candidate.md}}"

if [[ ! -f "${source_onboarding_path}" ]]; then
  echo "Missing source onboarding worksheet: ${source_onboarding_path}" >&2
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
  ' "${source_onboarding_path}"
}

strip_value() {
  printf "%s" "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

default_value() {
  local label="$1"
  strip_value "$(extract_field "${label}")"
}

mkdir -p "$(dirname "${output_onboarding_path}")"

cat > "${output_onboarding_path}" <<EOF
# Pilot Club Onboarding: Real Club

Scaffolded from \`${source_onboarding_path}\`.

Use this as the fastest starting point for the first real pilot candidate.
The workflow and policy defaults below came from the validated simulator packet.
Replace every blank field before running any hosted create step.

## Club Identity

- Candidate profile name:
- Organization name:
- Organization slug:
- Club name:
- Club slug:
- Team names and slugs:
- Age group:
- Primary launch date:

## People and Roles

- Executive sponsor:
- Day-to-day club lead:
- Launch decision owner:
- Day-one operator:
- Submitter accounts:
- Reviewer accounts:
- Escalation contact:

Map real people to the workflow roles:

- \`organization_admin\`:
- \`team_manager\`:
- \`club_comms\`:
- \`club_admin\`:
- Optional second approver:

Record the real names used to create the first pilot users:

- Submitter name and email:
- Organization admin name and email:
- Club admin name and email:
- Club comms reviewer name and email:
- Team manager reviewer name and email:

## Workflow Policy Decisions

- Default approver role: $(default_value "Default approver role")
- Public-content approver role: $(default_value "Public-content approver role")
- Medium-risk approver role: $(default_value "Medium-risk approver role")
- Allow Hermes agent routing: $(default_value "Allow Hermes agent routing")
- Auto-approve low-risk internal content at organization level: $(default_value "Auto-approve low-risk internal content at organization level")
- Auto-approve low-risk internal content at club effective level: $(default_value "Auto-approve low-risk internal content at club effective level")
- Auto-approve max risk threshold: $(default_value "Auto-approve max risk threshold")
- Allowed auto-approval content types: $(default_value "Allowed auto-approval content types")
- Should the club inherit org defaults unless explicitly noted: $(default_value "Should the club inherit org defaults unless explicitly noted")

## Approval and Publishing Rules

- Organization routing rule for \`video\`: $(default_value "Organization routing rule for \`video\`")
- Club effective routing rule for \`video\`: $(default_value "Club effective routing rule for \`video\`")
- Organization public-content second approval: $(default_value "Organization public-content second approval")
- Organization second approver role: $(default_value "Organization second approver role")
- Organization second-approval content types: $(default_value "Organization second-approval content types")
- Club effective public-content second approval: $(default_value "Club effective public-content second approval")
- Internal destinations: $(default_value "Internal destinations")
- Public destinations: $(default_value "Public destinations")

## Notification Decisions

- Require real email delivery for launch:
- Require real push delivery for launch:
- Organization notification default: $(default_value "Organization notification default")
- Club effective notification baseline: $(default_value "Club effective notification baseline")
- Notification posture on day one:
- Known delivery limitations or accepted gaps:

## Demo and QA Evidence

- Operator demo completed:
- Mobile review smoke completed:
- Pilot VPS scenario suite completed:
- Open rollout blockers:
- Go-live owner signoff:

## Rollback Plan

- Rollback owner:
- Rollback trigger:
- First override to remove if pilot behavior is wrong:
- Scenarios to rerun after rollback:
- Pilot-club communication owner:

## Notes Carried Forward

- Source simulator packet: \`${source_onboarding_path}\`
- Default policy posture was copied forward for review and can be changed if the real organization needs different routing or approval behavior.
- Delivery decisions, identities, and launch evidence are intentionally blank because they must be approved against the real club.
EOF

echo "pilot_scaffold_source_onboarding=${source_onboarding_path}"
echo "pilot_scaffold_output_onboarding=${output_onboarding_path}"
echo "pilot_scaffold_next_step=fill_real_fields"
