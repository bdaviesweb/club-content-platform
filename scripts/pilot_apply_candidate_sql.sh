#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
source "${script_dir}/load_pilot_candidate_env.sh" "${PILOT_CANDIDATE_PROFILE:-${1:-}}"

pilot_profile="${PILOT_CANDIDATE_PROFILE_NAME:-${1:-}}"
sql_mode="${2:-${PILOT_SQL_MODE:-create}}"
output_root="${PILOT_SQL_APPLY_OUTPUT_DIR:-${repo_root}/tmp/pilot-sql-apply}"
remote_host="${REMOTE_HOST:-hermes-dev}"
remote_dir="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
dry_run="${DRY_RUN:-0}"

if [[ -z "${pilot_profile}" ]]; then
  echo "Usage: bash scripts/pilot_apply_candidate_sql.sh <candidate-name-or-profile-path> [create|rollback]" >&2
  exit 1
fi

if [[ "${sql_mode}" != "create" && "${sql_mode}" != "rollback" ]]; then
  echo "sql mode must be create or rollback: ${sql_mode}" >&2
  exit 1
fi

creation_output_dir="${PILOT_CANDIDATE_CREATION_OUTPUT_DIR:-${repo_root}/tmp/pilot-candidate-create-plan}"
latest_creation_summary="$(
  find "${creation_output_dir}" -mindepth 2 -maxdepth 2 -type f -name summary.txt -path "*-${pilot_profile}/summary.txt" 2>/dev/null | sort | tail -n 1
)"

if [[ -z "${latest_creation_summary}" ]]; then
  echo "Could not find creation summary for candidate: ${pilot_profile}" >&2
  exit 1
fi

extract_summary_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "${latest_creation_summary}" | tail -n 1
}

create_sql_path="$(extract_summary_value "pilot_candidate_creation_create_sql")"
rollback_sql_path="$(extract_summary_value "pilot_candidate_creation_rollback_sql")"

if [[ "${sql_mode}" == "create" ]]; then
  sql_path="${create_sql_path}"
else
  sql_path="${rollback_sql_path}"
fi

if [[ -z "${sql_path}" || ! -f "${sql_path}" ]]; then
  echo "Missing ${sql_mode} SQL file for candidate ${pilot_profile}: ${sql_path}" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_dir="${output_root}/${timestamp}-${pilot_profile}-${sql_mode}"
logs_dir="${bundle_dir}/logs"
summary_path="${bundle_dir}/summary.txt"
handoff_path="${bundle_dir}/handoff.md"
status_path="${bundle_dir}/status.txt"
apply_log="${logs_dir}/${sql_mode}.log"
commands_path="${bundle_dir}/commands.txt"
mkdir -p "${logs_dir}"

record_file() {
  local path="$1"
  shift
  printf '%s\n' "$@" >> "${path}"
}

: > "${status_path}"
: > "${commands_path}"

record_file "${commands_path}" "candidate=${pilot_profile}"
record_file "${commands_path}" "sql_mode=${sql_mode}"
record_file "${commands_path}" "sql_path=${sql_path}"

overall_decision="GO"
remote_command="cd '${remote_dir}' && docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content"

echo "Pilot candidate SQL apply"
echo "Pilot candidate profile: ${pilot_profile}"
echo "SQL mode: ${sql_mode}"
echo "SQL path: ${sql_path}"
echo "Remote host: ${remote_host}"

if [[ "${dry_run}" == "1" ]]; then
  {
    echo "DRY_RUN ssh ${remote_host} \"${remote_command}\" < ${sql_path}"
  } | tee "${apply_log}"
  record_file "${status_path}" "apply=skipped"
else
  if ssh "${remote_host}" "${remote_command}" < "${sql_path}" > "${apply_log}" 2>&1; then
    cat "${apply_log}"
    record_file "${status_path}" "apply=ok"
  else
    cat "${apply_log}"
    record_file "${status_path}" "apply=failed"
    overall_decision="NO_GO"
  fi
fi

{
  echo "pilot_sql_apply_profile=${pilot_profile}"
  echo "pilot_sql_apply_mode=${sql_mode}"
  echo "pilot_sql_apply_sql_path=${sql_path}"
  echo "pilot_sql_apply_creation_summary=${latest_creation_summary}"
  echo "pilot_sql_apply_bundle_path=${bundle_dir}"
  echo "pilot_sql_apply_log=${apply_log}"
  echo "pilot_sql_apply_decision=${overall_decision}"
  cat "${status_path}"
} > "${summary_path}"

{
  echo "# Pilot Candidate SQL Apply"
  echo
  echo "- Candidate profile: \`${pilot_profile}\`"
  echo "- SQL mode: \`${sql_mode}\`"
  echo "- SQL path: \`${sql_path}\`"
  echo "- Creation summary: \`${latest_creation_summary}\`"
  echo "- Remote host: \`${remote_host}\`"
  echo "- Decision: \`${overall_decision}\`"
  echo "- Apply log: \`${apply_log}\`"
  echo
  echo "## Recorded Status"
  echo
  echo '```text'
  cat "${status_path}"
  echo '```'
} > "${handoff_path}"

echo "pilot_sql_apply_profile=${pilot_profile}"
echo "pilot_sql_apply_mode=${sql_mode}"
echo "pilot_sql_apply_sql_path=${sql_path}"
echo "pilot_sql_apply_creation_summary=${latest_creation_summary}"
echo "pilot_sql_apply_bundle_path=${bundle_dir}"
echo "pilot_sql_apply_log=${apply_log}"
echo "pilot_sql_apply_decision=${overall_decision}"

if [[ "${overall_decision}" != "GO" ]]; then
  exit 1
fi
