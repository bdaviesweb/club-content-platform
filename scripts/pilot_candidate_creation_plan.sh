#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
source "${script_dir}/load_pilot_candidate_env.sh" "${PILOT_CANDIDATE_PROFILE:-${1:-}}"

creation_output_dir="${PILOT_CANDIDATE_CREATION_OUTPUT_DIR:-${repo_root}/tmp/pilot-candidate-create-plan}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
profile_name="${PILOT_CANDIDATE_PROFILE_NAME:-${1:-candidate}}"
profile_slug="${profile_name//[^a-zA-Z0-9._-]/-}"
bundle_dir="${creation_output_dir}/${timestamp}-${profile_slug}"
plan_file="${bundle_dir}/creation-plan.md"
create_sql_file="${bundle_dir}/create.sql"
rollback_sql_file="${bundle_dir}/rollback.sql"
summary_file="${bundle_dir}/summary.txt"
preflight_output_file="${bundle_dir}/preflight.txt"

mkdir -p "${bundle_dir}"

required_creation_vars=(
  PILOT_CANDIDATE_PROFILE_NAME
  PILOT_ORGANIZATION_NAME
  PILOT_ORGANIZATION_SLUG
  PILOT_CLUB_NAME
  PILOT_CLUB_SLUG
  PILOT_TEAM_NAME
  PILOT_TEAM_SLUG
  PILOT_AGE_GROUP
  SUBMITTER_NAME
  SUBMITTER_EMAIL
  ORGANIZATION_ADMIN_NAME
  ORGANIZATION_ADMIN_EMAIL
  CLUB_ADMIN_NAME
  CLUB_ADMIN_EMAIL
  REVIEWER_NAME
  REVIEWER_EMAIL
  TEAM_MANAGER_REVIEWER_NAME
  TEAM_MANAGER_REVIEWER_EMAIL
)

missing=()
for var_name in "${required_creation_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("${var_name}")
  fi
done

decision="GO"
if [[ "${#missing[@]}" -gt 0 ]]; then
  decision="NO_GO"
fi

preflight_target="${PILOT_CANDIDATE_PROFILE_PATH:-${profile_name}}"
preflight_status=0
if bash "${script_dir}/validate_pilot_candidate_profile.sh" "${preflight_target}" > "${preflight_output_file}" 2>&1; then
  preflight_status=0
else
  preflight_status=$?
  decision="NO_GO"
fi

sql_escape() {
  printf "%s" "${1}" | sed "s/'/''/g"
}

org_name_sql="$(sql_escape "${PILOT_ORGANIZATION_NAME:-}")"
org_slug_sql="$(sql_escape "${PILOT_ORGANIZATION_SLUG:-}")"
club_name_sql="$(sql_escape "${PILOT_CLUB_NAME:-}")"
club_slug_sql="$(sql_escape "${PILOT_CLUB_SLUG:-}")"
team_name_sql="$(sql_escape "${PILOT_TEAM_NAME:-}")"
team_slug_sql="$(sql_escape "${PILOT_TEAM_SLUG:-}")"
age_group_sql="$(sql_escape "${PILOT_AGE_GROUP:-}")"
submitter_name_sql="$(sql_escape "${SUBMITTER_NAME:-}")"
submitter_email_sql="$(sql_escape "${SUBMITTER_EMAIL:-}")"
org_admin_name_sql="$(sql_escape "${ORGANIZATION_ADMIN_NAME:-}")"
org_admin_email_sql="$(sql_escape "${ORGANIZATION_ADMIN_EMAIL:-}")"
club_admin_name_sql="$(sql_escape "${CLUB_ADMIN_NAME:-}")"
club_admin_email_sql="$(sql_escape "${CLUB_ADMIN_EMAIL:-}")"
reviewer_name_sql="$(sql_escape "${REVIEWER_NAME:-}")"
reviewer_email_sql="$(sql_escape "${REVIEWER_EMAIL:-}")"
team_manager_name_sql="$(sql_escape "${TEAM_MANAGER_REVIEWER_NAME:-}")"
team_manager_email_sql="$(sql_escape "${TEAM_MANAGER_REVIEWER_EMAIL:-}")"

cat > "${create_sql_file}" <<EOF
BEGIN;

-- Create or update the organization, club, and team.
INSERT INTO organizations (slug, name)
VALUES ('${org_slug_sql}', '${org_name_sql}')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO clubs (organization_id, slug, name)
SELECT o.id, '${club_slug_sql}', '${club_name_sql}'
FROM organizations o
WHERE o.slug = '${org_slug_sql}'
ON CONFLICT (slug) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  name = EXCLUDED.name;

INSERT INTO teams (club_id, slug, name, age_group)
SELECT c.id, '${team_slug_sql}', '${team_name_sql}', '${age_group_sql}'
FROM clubs c
WHERE c.slug = '${club_slug_sql}'
ON CONFLICT (club_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  age_group = EXCLUDED.age_group;

-- Create or update the required users.
INSERT INTO users (email, full_name)
VALUES
  ('${submitter_email_sql}', '${submitter_name_sql}'),
  ('${org_admin_email_sql}', '${org_admin_name_sql}'),
  ('${club_admin_email_sql}', '${club_admin_name_sql}'),
  ('${reviewer_email_sql}', '${reviewer_name_sql}'),
  ('${team_manager_email_sql}', '${team_manager_name_sql}')
ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name;

-- Ensure the club/team memberships exist.
INSERT INTO memberships (club_id, team_id, user_id, role)
SELECT c.id, t.id, u.id, 'submitter_coach'::membership_role
FROM clubs c
JOIN teams t ON t.club_id = c.id AND t.slug = '${team_slug_sql}'
JOIN users u ON u.email = '${submitter_email_sql}'
WHERE c.slug = '${club_slug_sql}'
  AND NOT EXISTS (
    SELECT 1
    FROM memberships m
    WHERE m.club_id = c.id
      AND m.team_id = t.id
      AND m.user_id = u.id
      AND m.role = 'submitter_coach'::membership_role
  );

INSERT INTO memberships (club_id, team_id, user_id, role)
SELECT c.id, t.id, u.id, 'club_comms'::membership_role
FROM clubs c
JOIN teams t ON t.club_id = c.id AND t.slug = '${team_slug_sql}'
JOIN users u ON u.email = '${reviewer_email_sql}'
WHERE c.slug = '${club_slug_sql}'
  AND NOT EXISTS (
    SELECT 1
    FROM memberships m
    WHERE m.club_id = c.id
      AND m.team_id = t.id
      AND m.user_id = u.id
      AND m.role = 'club_comms'::membership_role
  );

INSERT INTO memberships (club_id, team_id, user_id, role)
SELECT c.id, t.id, u.id, 'club_admin'::membership_role
FROM clubs c
JOIN teams t ON t.club_id = c.id AND t.slug = '${team_slug_sql}'
JOIN users u ON u.email = '${club_admin_email_sql}'
WHERE c.slug = '${club_slug_sql}'
  AND NOT EXISTS (
    SELECT 1
    FROM memberships m
    WHERE m.club_id = c.id
      AND m.team_id = t.id
      AND m.user_id = u.id
      AND m.role = 'club_admin'::membership_role
  );

INSERT INTO memberships (club_id, team_id, user_id, role)
SELECT c.id, t.id, u.id, 'team_manager'::membership_role
FROM clubs c
JOIN teams t ON t.club_id = c.id AND t.slug = '${team_slug_sql}'
JOIN users u ON u.email = '${team_manager_email_sql}'
WHERE c.slug = '${club_slug_sql}'
  AND NOT EXISTS (
    SELECT 1
    FROM memberships m
    WHERE m.club_id = c.id
      AND m.team_id = t.id
      AND m.user_id = u.id
      AND m.role = 'team_manager'::membership_role
  );

-- Ensure the organization admin membership exists.
INSERT INTO organization_memberships (organization_id, user_id, role)
SELECT o.id, u.id, 'organization_admin'::organization_membership_role
FROM organizations o
JOIN users u ON u.email = '${org_admin_email_sql}'
WHERE o.slug = '${org_slug_sql}'
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.organization_id = o.id
      AND om.user_id = u.id
      AND om.role = 'organization_admin'::organization_membership_role
  );

-- Ensure the internal publishing destination exists.
INSERT INTO publishing_destinations (club_id, destination_type, name, config, is_active)
SELECT c.id, 'internal_feed', 'Internal Club Feed', '{"mode":"internal"}'::jsonb, TRUE
FROM clubs c
WHERE c.slug = '${club_slug_sql}'
  AND NOT EXISTS (
    SELECT 1
    FROM publishing_destinations pd
    WHERE pd.club_id = c.id
      AND pd.destination_type = 'internal_feed'
      AND pd.name = 'Internal Club Feed'
  );

COMMIT;
EOF

cat > "${rollback_sql_file}" <<EOF
BEGIN;

-- Remove memberships created for this candidate if a rollback is required.
DELETE FROM memberships
WHERE club_id = (SELECT id FROM clubs WHERE slug = '${club_slug_sql}')
  AND team_id = (
    SELECT id
    FROM teams
    WHERE club_id = (SELECT id FROM clubs WHERE slug = '${club_slug_sql}')
      AND slug = '${team_slug_sql}'
  )
  AND user_id IN (
    SELECT id
    FROM users
    WHERE email IN (
      '${submitter_email_sql}',
      '${reviewer_email_sql}',
      '${club_admin_email_sql}',
      '${team_manager_email_sql}'
    )
  );

DELETE FROM organization_memberships
WHERE organization_id = (SELECT id FROM organizations WHERE slug = '${org_slug_sql}')
  AND user_id = (SELECT id FROM users WHERE email = '${org_admin_email_sql}')
  AND role = 'organization_admin'::organization_membership_role;

DELETE FROM publishing_destinations
WHERE club_id = (SELECT id FROM clubs WHERE slug = '${club_slug_sql}')
  AND destination_type = 'internal_feed'
  AND name = 'Internal Club Feed'
  AND config = '{"mode":"internal"}'::jsonb;

-- Optional manual cleanup after review:
-- DELETE FROM teams WHERE club_id = (SELECT id FROM clubs WHERE slug = '${club_slug_sql}') AND slug = '${team_slug_sql}';
-- DELETE FROM clubs WHERE slug = '${club_slug_sql}';
-- DELETE FROM organizations WHERE slug = '${org_slug_sql}';
-- DELETE FROM users WHERE email IN (
--   '${submitter_email_sql}',
--   '${org_admin_email_sql}',
--   '${club_admin_email_sql}',
--   '${reviewer_email_sql}',
--   '${team_manager_email_sql}'
-- );

COMMIT;
EOF

{
  echo "pilot_candidate_creation_profile=${profile_name}"
  echo "pilot_candidate_creation_profile_path=${PILOT_CANDIDATE_PROFILE_PATH:-unknown}"
  echo "pilot_candidate_creation_bundle=${bundle_dir}"
  echo "pilot_candidate_creation_plan=${plan_file}"
  echo "pilot_candidate_creation_create_sql=${create_sql_file}"
  echo "pilot_candidate_creation_rollback_sql=${rollback_sql_file}"
  echo "pilot_candidate_creation_preflight=${preflight_output_file}"
  echo "pilot_candidate_creation_decision=${decision}"
  echo "pilot_candidate_creation_preflight_status=${preflight_status}"
  if [[ "${#missing[@]}" -gt 0 ]]; then
    for item in "${missing[@]}"; do
      echo "missing=${item}"
    done
  fi
} > "${summary_file}"

{
  echo "# Pilot Candidate Creation Plan"
  echo
  echo "- Profile: \`${profile_name}\`"
  echo "- Profile path: \`${PILOT_CANDIDATE_PROFILE_PATH:-unknown}\`"
  echo "- Decision: \`${decision}\`"
  echo "- Create SQL: \`${create_sql_file}\`"
  echo "- Rollback SQL: \`${rollback_sql_file}\`"
  echo "- Preflight output: \`${preflight_output_file}\`"
  echo "- Summary file: \`${summary_file}\`"
  echo
  echo "## Creation Scope"
  echo
  echo "This plan prepares the minimum records for a controlled pilot candidate:"
  echo "- organization"
  echo "- club"
  echo "- team"
  echo "- submitter user"
  echo "- organization admin user and membership"
  echo "- club reviewer roles: club_comms, club_admin, team_manager"
  echo "- internal publishing destination"
  echo
  echo "## Execution Guardrails"
  echo
  echo "1. Run this only after the onboarding worksheet and activation checklist are filled out."
  echo "2. Review both SQL files before applying anything to a hosted database."
  echo "3. Keep hosted audit and VPS verification immediately after creation."
  echo "4. Keep the rollback SQL next to the creation evidence so the operator can reverse the first setup quickly."
  echo
  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "## Missing Required Fields"
    echo
    for item in "${missing[@]}"; do
      echo "- ${item}"
    done
    echo
  fi
  echo "## Candidate Preflight Output"
  echo
  echo '```text'
  cat "${preflight_output_file}"
  echo '```'
  echo
  echo "## Candidate Summary"
  echo
  echo "- Organization: \`${PILOT_ORGANIZATION_NAME:-<unset>}\` / \`${PILOT_ORGANIZATION_SLUG:-<unset>}\`"
  echo "- Club: \`${PILOT_CLUB_NAME:-<unset>}\` / \`${PILOT_CLUB_SLUG:-<unset>}\`"
  echo "- Team: \`${PILOT_TEAM_NAME:-<unset>}\` / \`${PILOT_TEAM_SLUG:-<unset>}\`"
  echo "- Age group: \`${PILOT_AGE_GROUP:-<unset>}\`"
  echo "- Submitter: \`${SUBMITTER_NAME:-<unset>}\` <\`${SUBMITTER_EMAIL:-<unset>}\`>"
  echo "- Organization admin: \`${ORGANIZATION_ADMIN_NAME:-<unset>}\` <\`${ORGANIZATION_ADMIN_EMAIL:-<unset>}\`>"
  echo "- Club admin: \`${CLUB_ADMIN_NAME:-<unset>}\` <\`${CLUB_ADMIN_EMAIL:-<unset>}\`>"
  echo "- Club comms reviewer: \`${REVIEWER_NAME:-<unset>}\` <\`${REVIEWER_EMAIL:-<unset>}\`>"
  echo "- Team manager reviewer: \`${TEAM_MANAGER_REVIEWER_NAME:-<unset>}\` <\`${TEAM_MANAGER_REVIEWER_EMAIL:-<unset>}\`>"
} > "${plan_file}"

echo "pilot_candidate_creation_plan=${plan_file}"
echo "pilot_candidate_creation_create_sql=${create_sql_file}"
echo "pilot_candidate_creation_rollback_sql=${rollback_sql_file}"
echo "pilot_candidate_creation_preflight=${preflight_output_file}"
echo "pilot_candidate_creation_decision=${decision}"

if [[ "${decision}" != "GO" ]]; then
  exit 1
fi
