#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

if [[ -n "${PILOT_DEMO_RUNTIME_ROOT:-}" ]]; then
  runtime_root="${PILOT_DEMO_RUNTIME_ROOT}"
  runtime_path_entries=()
  [[ -d "${runtime_root}/bin" ]] && runtime_path_entries+=("${runtime_root}/bin")
  [[ -d "${runtime_root}/Postgres.app/Contents/Versions/16/bin" ]] && runtime_path_entries+=("${runtime_root}/Postgres.app/Contents/Versions/16/bin")
  [[ -d "${runtime_root}/Postgres.app/Contents/Versions/17/bin" ]] && runtime_path_entries+=("${runtime_root}/Postgres.app/Contents/Versions/17/bin")
  [[ -d "${runtime_root}/Postgres.app/Contents/Versions/18/bin" ]] && runtime_path_entries+=("${runtime_root}/Postgres.app/Contents/Versions/18/bin")
  if (( ${#runtime_path_entries[@]} > 0 )); then
    PATH="$(IFS=:; printf '%s' "${runtime_path_entries[*]}"):${PATH}"
    export PATH
  fi
fi

pilot_profile="${1:-${PILOT_CANDIDATE_PROFILE:-simulated-north-river}}"
DRY_RUN="${DRY_RUN:-0}"
output_root="${PILOT_DEMO_OUTPUT_DIR:-${repo_root}/tmp/pilot-demo}"
ADMIN_PORT="${ADMIN_PORT:-3013}"
MOBILE_PORT="${MOBILE_PORT:-8082}"
API_PORT="${API_PORT:-4000}"
OPEN_SURFACES="${OPEN_SURFACES:-1}"
SKIP_LOCAL_SERVICES="${SKIP_LOCAL_SERVICES:-0}"
SKIP_SIMULATOR_STATE="${SKIP_SIMULATOR_STATE:-0}"
RUNTIME_MODE="${PILOT_DEMO_RUNTIME_MODE:-auto}"

source "${script_dir}/load_pilot_candidate_env.sh" "${pilot_profile}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
profile_slug="${pilot_profile//[^a-zA-Z0-9._-]/-}"
bundle_dir="${output_root}/${timestamp}-${profile_slug}"
logs_dir="${bundle_dir}/logs"
artifacts_dir="${bundle_dir}/artifacts"
runtime_dir="${output_root}/runtime"
mkdir -p "${logs_dir}"
mkdir -p "${artifacts_dir}"
mkdir -p "${runtime_dir}"

summary_file="${bundle_dir}/summary.txt"
status_file="${bundle_dir}/status.txt"
commands_file="${bundle_dir}/commands.txt"
runbook_file="${bundle_dir}/runbook.md"
evidence_file="${bundle_dir}/evidence.md"
links_file="${bundle_dir}/links.txt"
preflight_file="${bundle_dir}/preflight.md"
manifest_json_file="${bundle_dir}/manifest.json"

: >"${summary_file}"
: >"${status_file}"
: >"${commands_file}"

local_api_base="http://127.0.0.1:${API_PORT}"
database_url="${DATABASE_URL:-postgresql://club:club@localhost:5432/club_content}"
redis_url="${REDIS_URL:-redis://localhost:6379}"
s3_endpoint="${S3_ENDPOINT:-http://localhost:9000}"
s3_bucket="${S3_BUCKET:-club-content}"
s3_access_key="${S3_ACCESS_KEY:-minioadmin}"
s3_secret_key="${S3_SECRET_KEY:-minioadmin}"
s3_public_base_url="${S3_PUBLIC_BASE_URL:-http://localhost:9000}"
demo_url="http://127.0.0.1:${ADMIN_PORT}/demo"
quick_review_url="http://127.0.0.1:${ADMIN_PORT}/quick-review"
workflow_settings_url="http://127.0.0.1:${ADMIN_PORT}/workflow-settings?organizationMode=simulator&clubSlug=${PILOT_CLUB_SLUG:-${CLUB_SLUG:-north-river-soccer-club}}"
internal_feed_url="${local_api_base}/feed/internal?includeSmoke=1"
expo_url="${EXPO_URL:-exp://127.0.0.1:${MOBILE_PORT}}"
happy_path_post_url="${expo_url}${expo_url#*\?}" # placeholder overwritten below when no query string exists

if [[ "${expo_url}" == *"?"* ]]; then
  happy_path_post_url="${expo_url}&demoAction=post"
else
  happy_path_post_url="${expo_url}?demoAction=post"
fi

happy_path_review_url="${quick_review_url}"
exception_auto_approval_url="${workflow_settings_url}&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.12&simulationModerationFlagged=false"
exception_second_approval_url="${workflow_settings_url}&simulationContentType=video&simulationVisibilityTarget=public&simulationRiskScore=0.42&simulationModerationFlagged=false"

log_line() {
  printf '%s\n' "$1" | tee -a "${summary_file}"
}

record_status() {
  printf '%s\n' "$1" >> "${status_file}"
}

record_command() {
  printf '%s\n' "$1" >> "${commands_file}"
}

have_local_runtime() {
  case "${RUNTIME_MODE}" in
    force_available)
      return 0
      ;;
    force_unavailable)
      return 1
      ;;
  esac

  if command -v docker >/dev/null 2>&1; then
    return 0
  fi

  if command -v postgres >/dev/null 2>&1 && command -v redis-server >/dev/null 2>&1 && command -v minio >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-40}"
  local sleep_seconds="${3:-1}"

  for ((i = 0; i < attempts; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  return 1
}

wait_for_stable_http() {
  local url="$1"
  local attempts="${2:-40}"
  local sleep_seconds="${3:-1}"
  local required_streak="${4:-3}"
  local streak=0

  for ((i = 0; i < attempts; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      streak=$((streak + 1))
      if (( streak >= required_streak )); then
        return 0
      fi
    else
      streak=0
    fi
    sleep "${sleep_seconds}"
  done

  return 1
}

port_is_listening() {
  local port="$1"
  lsof -iTCP:"${port}" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

shell_escape() {
  printf '%q' "$1"
}

services_command() {
  if [[ -n "${PILOT_DEMO_SERVICES_COMMAND:-}" ]]; then
    printf '%s' "${PILOT_DEMO_SERVICES_COMMAND}"
    return
  fi

  printf 'docker compose up -d postgres redis minio && node %s' "$(shell_escape "${script_dir}/wait_for_local_services.mjs")"
}

api_command() {
  if [[ -n "${PILOT_DEMO_API_COMMAND:-}" ]]; then
    printf '%s' "${PILOT_DEMO_API_COMMAND}"
    return
  fi

  printf 'env DATABASE_URL=%s REDIS_URL=%s S3_ENDPOINT=%s S3_BUCKET=%s S3_ACCESS_KEY=%s S3_SECRET_KEY=%s S3_PUBLIC_BASE_URL=%s API_PORT=%s npm --workspace @club/app-api run dev' \
    "$(shell_escape "${database_url}")" \
    "$(shell_escape "${redis_url}")" \
    "$(shell_escape "${s3_endpoint}")" \
    "$(shell_escape "${s3_bucket}")" \
    "$(shell_escape "${s3_access_key}")" \
    "$(shell_escape "${s3_secret_key}")" \
    "$(shell_escape "${s3_public_base_url}")" \
    "$(shell_escape "${API_PORT}")"
}

worker_command() {
  if [[ -n "${PILOT_DEMO_WORKER_COMMAND:-}" ]]; then
    printf '%s' "${PILOT_DEMO_WORKER_COMMAND}"
    return
  fi

  printf 'env DATABASE_URL=%s REDIS_URL=%s S3_ENDPOINT=%s S3_BUCKET=%s S3_ACCESS_KEY=%s S3_SECRET_KEY=%s S3_PUBLIC_BASE_URL=%s npm --workspace @club/worker run dev' \
    "$(shell_escape "${database_url}")" \
    "$(shell_escape "${redis_url}")" \
    "$(shell_escape "${s3_endpoint}")" \
    "$(shell_escape "${s3_bucket}")" \
    "$(shell_escape "${s3_access_key}")" \
    "$(shell_escape "${s3_secret_key}")" \
    "$(shell_escape "${s3_public_base_url}")"
}

simulator_state_command() {
  if [[ -n "${PILOT_DEMO_SIMULATOR_COMMAND:-}" ]]; then
    printf '%s' "${PILOT_DEMO_SIMULATOR_COMMAND}"
    return
  fi

  printf 'env DATABASE_URL=%s npm run pilot:simulator-state' "$(shell_escape "${database_url}")"
}

operator_command() {
  local operator_env
  operator_env=$(printf 'env API_BASE_URL=%s EXPO_PUBLIC_API_BASE_URL=%s LOG_DIR=%s ADMIN_PORT=%s MOBILE_PORT=%s' \
    "$(shell_escape "${local_api_base}")" \
    "$(shell_escape "${local_api_base}")" \
    "$(shell_escape "${logs_dir}")" \
    "$(shell_escape "${ADMIN_PORT}")" \
    "$(shell_escape "${MOBILE_PORT}")")

  if [[ -n "${PILOT_DEMO_OPERATOR_COMMAND:-}" ]]; then
    printf '%s %s' "${operator_env}" "${PILOT_DEMO_OPERATOR_COMMAND}"
    return
  fi

  printf '%s DETACH=1 bash scripts/start_demo_operator.sh' "${operator_env}"
}

open_surfaces_command() {
  if [[ -n "${PILOT_DEMO_OPEN_COMMAND:-}" ]]; then
    printf '%s' "${PILOT_DEMO_OPEN_COMMAND}"
    return
  fi

  printf 'open %s %s %s' \
    "$(shell_escape "${demo_url}")" \
    "$(shell_escape "${quick_review_url}")" \
    "$(shell_escape "${workflow_settings_url}")"
}

boot_local_services() {
  bash -lc "$(services_command)"
}

boot_binary_services() {
  local runtime_state_root="${PILOT_DEMO_RUNTIME_STATE_ROOT:-${HOME}/.club-content-pilot-runtime/state}"
  local postgres_root="${runtime_state_root}/postgres"
  local postgres_data_dir="${postgres_root}/data"
  local postgres_log_file="${postgres_root}/postgres.log"
  local postgres_schema_marker="${postgres_root}/schema-loaded"
  local redis_root="${runtime_state_root}/redis"
  local redis_data_dir="${redis_root}/data"
  local redis_log_file="${redis_root}/redis.log"
  local redis_pid_file="${redis_root}/redis.pid"
  local redis_conf_file="${redis_root}/redis.conf"
  local minio_root="${runtime_state_root}/minio"
  local minio_data_dir="${minio_root}/data"
  local minio_log_file="${minio_root}/minio.log"
  local minio_pid_file="${minio_root}/minio.pid"

  mkdir -p "${postgres_root}" "${redis_root}" "${minio_root}" "${redis_data_dir}" "${minio_data_dir}"

  if ! port_is_listening 5432; then
    if [[ ! -d "${postgres_data_dir}" || ! -f "${postgres_data_dir}/PG_VERSION" ]]; then
      initdb -D "${postgres_data_dir}" -U club --auth-host=trust --auth-local=trust >/dev/null
    fi

    pg_ctl -D "${postgres_data_dir}" -l "${postgres_log_file}" -o "-p 5432" start >/dev/null
  fi

  if [[ ! -f "${postgres_schema_marker}" ]]; then
    createdb -h 127.0.0.1 -p 5432 -U club club_content >/dev/null 2>&1 || true
    psql -h 127.0.0.1 -p 5432 -U club -d club_content -f "${repo_root}/db/schema.sql" >/dev/null
    touch "${postgres_schema_marker}"
  fi

  if ! port_is_listening 6379; then
    cat > "${redis_conf_file}" <<EOF
port 6379
bind 127.0.0.1
dir ${redis_data_dir}
logfile ${redis_log_file}
pidfile ${redis_pid_file}
daemonize yes
EOF
    redis-server "${redis_conf_file}" >/dev/null
  fi

  if ! port_is_listening 9000; then
    MINIO_ROOT_USER="${s3_access_key}" \
      MINIO_ROOT_PASSWORD="${s3_secret_key}" \
      nohup minio server "${minio_data_dir}" --address ":9000" --console-address ":9001" > "${minio_log_file}" 2>&1 &
    echo $! > "${minio_pid_file}"
  fi

  node "${script_dir}/wait_for_local_services.mjs"
}

run_step() {
  local step_key="$1"
  local label="$2"
  local output_file="$3"
  shift 3

  log_line "==> ${label}"

  local command_line=""
  for arg in "$@"; do
    command_line+=" $(printf '%q' "${arg}")"
  done
  command_line="${command_line# }"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_line "DRY_RUN ${command_line}"
    printf 'DRY_RUN %s\n' "${command_line}" > "${output_file}"
    record_command "${command_line}"
    record_status "${step_key}=skipped"
    return 0
  fi

  record_command "${command_line}"
  if "$@" >"${output_file}" 2>&1; then
    record_status "${step_key}=ok"
    log_line "${step_key}=ok"
    return 0
  fi

  local exit_code=$?
  record_status "${step_key}=failed exit_code=${exit_code}"
  log_line "${step_key}=failed exit_code=${exit_code}"
  return "${exit_code}"
}

run_shell_step() {
  local step_key="$1"
  local label="$2"
  local output_file="$3"
  local command_string="$4"

  log_line "==> ${label}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_line "DRY_RUN ${command_string}"
    printf 'DRY_RUN %s\n' "${command_string}" > "${output_file}"
    record_command "${command_string}"
    record_status "${step_key}=skipped"
    return 0
  fi

  record_command "${command_string}"
  if bash -lc "${command_string}" > "${output_file}" 2>&1; then
    record_status "${step_key}=ok"
    log_line "${step_key}=ok"
    return 0
  fi

  local exit_code=$?
  record_status "${step_key}=failed exit_code=${exit_code}"
  log_line "${step_key}=failed exit_code=${exit_code}"
  return "${exit_code}"
}

services_output="${logs_dir}/services.log"
api_output="${logs_dir}/api.log"
worker_output="${logs_dir}/worker.log"
simulator_output="${logs_dir}/simulator-state.log"
operator_output="${logs_dir}/operator.log"
open_output="${logs_dir}/open.log"
artifacts_output="${logs_dir}/artifacts.log"
operator_admin_log="${logs_dir}/admin-demo.log"
operator_mobile_log="${logs_dir}/mobile-demo.log"
api_pid_file="${runtime_dir}/pilot-demo-api.pid"
worker_pid_file="${runtime_dir}/pilot-demo-worker.pid"

log_line "pilot_demo_profile=${pilot_profile}"
log_line "pilot_demo_profile_path=${PILOT_CANDIDATE_PROFILE_PATH:-<unset>}"
log_line "pilot_demo_bundle_path=${bundle_dir}"
log_line "pilot_demo_runbook_path=${runbook_file}"
log_line "pilot_demo_evidence_path=${evidence_file}"
log_line "pilot_demo_preflight_path=${preflight_file}"

overall_status=0
local_runtime_available="false"
if have_local_runtime; then
  local_runtime_available="true"
fi

start_background_process() {
  local pid_file="$1"
  local output_file="$2"
  shift 2

  (
    cd "${repo_root}"
    nohup "$@" </dev/null > "${output_file}" 2>&1 &
    echo $! > "${pid_file}"
  )
}

start_background_shell_process() {
  local pid_file="$1"
  local output_file="$2"
  local command_string="$3"

  (
    cd "${repo_root}"
    nohup bash -lc "${command_string}" </dev/null > "${output_file}" 2>&1 &
    echo $! > "${pid_file}"
  )
}

capture_http_artifact() {
  local label="$1"
  local url="$2"
  local body_file="$3"
  local headers_file="$4"

  {
    echo "==> Capture ${label}"
    echo "url=${url}"
  } >> "${artifacts_output}"

  if curl -fsS -D "${headers_file}" "${url}" > "${body_file}"; then
    {
      echo "result=ok"
      echo "body=${body_file}"
      echo "headers=${headers_file}"
      echo
    } >> "${artifacts_output}"
    return 0
  fi

  local exit_code=$?
  {
    echo "result=failed exit_code=${exit_code}"
    echo "body=${body_file}"
    echo "headers=${headers_file}"
    echo
  } >> "${artifacts_output}"
  return "${exit_code}"
}

if [[ "${SKIP_LOCAL_SERVICES}" == "1" ]]; then
  printf '%s\n' "Local services skipped because SKIP_LOCAL_SERVICES=1." > "${services_output}"
  record_status "services=skipped"
  log_line "services=skipped"
elif [[ "${DRY_RUN}" == "1" ]]; then
  services_cmd="$(services_command)"
  log_line "==> Boot local demo services"
  log_line "DRY_RUN ${services_cmd}"
  {
    printf 'DRY_RUN %s\n' "${services_cmd}"
  } > "${services_output}"
  record_command "${services_cmd}"
  record_status "services=skipped"
elif [[ "${local_runtime_available}" != "true" ]]; then
  printf '%s\n' "No local runtime is available for Postgres, Redis, and MinIO on this machine." > "${services_output}"
  record_status "services=blocked runtime"
  log_line "services=blocked runtime"
elif [[ -n "${PILOT_DEMO_SERVICES_COMMAND:-}" ]] || command -v docker >/dev/null 2>&1; then
  services_cmd="$(services_command)"
  log_line "==> Boot local demo services"
  record_command "${services_cmd}"
  if boot_local_services > "${services_output}" 2>&1; then
    record_status "services=ok"
    log_line "services=ok"
  else
    exit_code=$?
    record_status "services=failed exit_code=${exit_code}"
    log_line "services=failed exit_code=${exit_code}"
    overall_status=1
  fi
elif command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1 && command -v createdb >/dev/null 2>&1 && command -v psql >/dev/null 2>&1 && command -v redis-server >/dev/null 2>&1 && command -v minio >/dev/null 2>&1; then
  log_line "==> Boot local demo services"
  record_command "binary-runtime bootstrap (postgres, redis, minio)"
  if boot_binary_services > "${services_output}" 2>&1; then
    record_status "services=ok"
    log_line "services=ok"
  else
    exit_code=$?
    record_status "services=failed exit_code=${exit_code}"
    log_line "services=failed exit_code=${exit_code}"
    overall_status=1
  fi
else
  printf '%s\n' "Docker is unavailable, so the script could not boot local Postgres, Redis, and MinIO." > "${services_output}"
  record_status "services=blocked docker"
  log_line "services=blocked docker"
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  api_cmd="$(api_command)"
  worker_cmd="$(worker_command)"
  run_shell_step "api" "Start local app API" "${api_output}" "${api_cmd}" || overall_status=1
  run_shell_step "worker" "Start local worker" "${worker_output}" "${worker_cmd}" || overall_status=1
elif [[ "${local_runtime_available}" != "true" ]]; then
  printf '%s\n' "Local app API was not started because no supported local runtime is available." > "${api_output}"
  record_status "api=blocked runtime"
  log_line "api=blocked runtime"
  printf '%s\n' "Local worker was not started because no supported local runtime is available." > "${worker_output}"
  record_status "worker=blocked runtime"
  log_line "worker=blocked runtime"
else
  log_line "==> Start local app API"
  if wait_for_stable_http "${local_api_base}/health" 3 1 3; then
    printf '%s\n' "Local app API already responds consistently at ${local_api_base}." > "${api_output}"
    record_status "api=existing"
    log_line "api=existing"
  else
    api_cmd="$(api_command)"
    start_background_shell_process "${api_pid_file}" "${api_output}" "${api_cmd}"
    record_command "${api_cmd}"
    if wait_for_stable_http "${local_api_base}/health" 60 1 3; then
      record_status "api=ok"
      log_line "api=ok"
    else
      record_status "api=failed readiness"
      log_line "api=failed readiness"
      overall_status=1
    fi
  fi

  log_line "==> Start local worker"
  if [[ -f "${worker_pid_file}" ]] && kill -0 "$(cat "${worker_pid_file}")" 2>/dev/null; then
    printf '%s\n' "Local worker already running with pid $(cat "${worker_pid_file}")." > "${worker_output}"
    record_status "worker=existing"
    log_line "worker=existing"
  else
    worker_cmd="$(worker_command)"
    start_background_shell_process "${worker_pid_file}" "${worker_output}" "${worker_cmd}"
    record_command "${worker_cmd}"
    sleep 2
    if [[ -f "${worker_pid_file}" ]] && kill -0 "$(cat "${worker_pid_file}")" 2>/dev/null; then
      record_status "worker=ok"
      log_line "worker=ok"
    else
      record_status "worker=failed start"
      log_line "worker=failed start"
      overall_status=1
    fi
  fi
fi

if [[ "${SKIP_SIMULATOR_STATE}" == "1" ]]; then
  printf '%s\n' "Simulator state reset skipped because SKIP_SIMULATOR_STATE=1." > "${simulator_output}"
  record_status "simulator_state=skipped"
  log_line "simulator_state=skipped"
elif [[ "${DRY_RUN}" != "1" && "${local_runtime_available}" != "true" ]]; then
  printf '%s\n' "Simulator state reset was not attempted because the local runtime is unavailable." > "${simulator_output}"
  record_status "simulator_state=blocked runtime"
  log_line "simulator_state=blocked runtime"
else
  simulator_cmd="$(simulator_state_command)"
  run_shell_step "simulator_state" "Reset simulator organization state" "${simulator_output}" "${simulator_cmd}" || overall_status=1
fi

can_launch_operator=1
if [[ "${DRY_RUN}" != "1" ]]; then
  if grep -Eq '^(api|simulator_state)=(failed|blocked)' "${status_file}" 2>/dev/null; then
    can_launch_operator=0
  fi
fi

if [[ "${can_launch_operator}" == "1" ]]; then
  operator_cmd="$(operator_command)"
  run_shell_step "operator" "Start operator demo surfaces" "${operator_output}" "${operator_cmd}" || overall_status=1
else
  printf '%s\n' "Operator surfaces were not started because the local API or simulator reset did not complete successfully." > "${operator_output}"
  record_status "operator=blocked"
  log_line "operator=blocked"
fi

if [[ "${can_launch_operator}" != "1" ]]; then
  printf '%s\n' "Surface opening was skipped because the operator surfaces were not started." > "${open_output}"
  record_status "open=blocked"
  log_line "open=blocked"
elif [[ "${OPEN_SURFACES}" == "0" ]]; then
  printf '%s\n' "Surface opening skipped because OPEN_SURFACES=0." > "${open_output}"
  record_status "open=skipped"
  log_line "open=skipped"
elif [[ "${DRY_RUN}" == "1" ]]; then
  open_cmd="$(open_surfaces_command)"
  run_shell_step "open" "Open demo surfaces" "${open_output}" "${open_cmd}" || overall_status=1
elif [[ -n "${PILOT_DEMO_OPEN_COMMAND:-}" ]]; then
  open_cmd="$(open_surfaces_command)"
  run_shell_step "open" "Open demo surfaces" "${open_output}" "${open_cmd}" || overall_status=1
elif command -v open >/dev/null 2>&1; then
  open_cmd="$(open_surfaces_command)"
  run_shell_step "open" "Open demo surfaces" "${open_output}" "${open_cmd}" || overall_status=1
else
  printf '%s\n' "The open command is unavailable, so the script left the URLs in the runbook instead." > "${open_output}"
  record_status "open=unavailable"
  log_line "open=unavailable"
fi

capture_plan_file="${artifacts_dir}/capture-plan.txt"
capture_manifest_file="${artifacts_dir}/manifest.txt"
{
  echo "demo_command_center|${demo_url}|${artifacts_dir}/demo-command-center.html"
  echo "quick_review|${quick_review_url}|${artifacts_dir}/quick-review.html"
  echo "workflow_settings|${workflow_settings_url}|${artifacts_dir}/workflow-settings.html"
  echo "exception_auto_approval|${exception_auto_approval_url}|${artifacts_dir}/exception-auto-approval.html"
  echo "exception_second_approval|${exception_second_approval_url}|${artifacts_dir}/exception-second-approval.html"
  echo "internal_feed|${internal_feed_url}|${artifacts_dir}/internal-feed.json"
} > "${capture_manifest_file}"

if [[ "${can_launch_operator}" != "1" ]]; then
  {
    echo "Artifact capture was skipped because the operator surfaces were not started."
    echo
    cat "${capture_manifest_file}"
  } > "${capture_plan_file}"
  printf '%s\n' "Artifact capture skipped because operator surfaces were unavailable." > "${artifacts_output}"
  record_status "artifacts=blocked"
  log_line "artifacts=blocked"
elif [[ "${DRY_RUN}" == "1" ]]; then
  {
    echo "Artifact capture plan for a live run:"
    echo
    cat "${capture_manifest_file}"
  } > "${capture_plan_file}"
  printf '%s\n' "Artifact capture skipped because DRY_RUN=1." > "${artifacts_output}"
  record_status "artifacts=skipped"
  log_line "artifacts=skipped"
else
  : > "${artifacts_output}"
  capture_failures=0
  capture_http_artifact "demo command center" "${demo_url}" "${artifacts_dir}/demo-command-center.html" "${artifacts_dir}/demo-command-center.headers" || capture_failures=1
  capture_http_artifact "quick review" "${quick_review_url}" "${artifacts_dir}/quick-review.html" "${artifacts_dir}/quick-review.headers" || capture_failures=1
  capture_http_artifact "workflow settings" "${workflow_settings_url}" "${artifacts_dir}/workflow-settings.html" "${artifacts_dir}/workflow-settings.headers" || capture_failures=1
  capture_http_artifact "organization auto-approval exception" "${exception_auto_approval_url}" "${artifacts_dir}/exception-auto-approval.html" "${artifacts_dir}/exception-auto-approval.headers" || capture_failures=1
  capture_http_artifact "public video second approval exception" "${exception_second_approval_url}" "${artifacts_dir}/exception-second-approval.html" "${artifacts_dir}/exception-second-approval.headers" || capture_failures=1
  capture_http_artifact "internal feed" "${internal_feed_url}" "${artifacts_dir}/internal-feed.json" "${artifacts_dir}/internal-feed.headers" || capture_failures=1
  if [[ "${capture_failures}" == "0" ]]; then
    record_status "artifacts=ok"
    log_line "artifacts=ok"
  else
    record_status "artifacts=failed"
    log_line "artifacts=failed"
    overall_status=1
  fi
fi

decision="GO"
if grep -Eq '(failed|blocked)' "${status_file}" 2>/dev/null; then
  decision="NO_GO"
fi

docker_available="false"
if command -v docker >/dev/null 2>&1; then
  docker_available="true"
fi

remediation_needed="false"
if [[ "${decision}" == "NO_GO" ]]; then
  remediation_needed="true"
fi

{
  echo "# Pilot Demo Preflight"
  echo
  echo "- Profile: \`${pilot_profile}\`"
  echo "- Decision: \`${decision}\`"
  echo "- Docker available: \`${docker_available}\`"
  echo "- Local runtime available: \`${local_runtime_available}\`"
  echo "- Runtime mode: \`${RUNTIME_MODE}\`"
  echo "- Skip local services: \`${SKIP_LOCAL_SERVICES}\`"
  echo "- Skip simulator reset: \`${SKIP_SIMULATOR_STATE}\`"
  echo "- Local API base: \`${local_api_base}\`"
  echo "- Demo command center: \`${demo_url}\`"
  echo "- Quick review: \`${quick_review_url}\`"
  echo "- Simulator workflow settings: \`${workflow_settings_url}\`"
  echo "- Artifact manifest: \`${capture_manifest_file}\`"
  echo "- Machine manifest: \`${manifest_json_file}\`"
  if [[ "${remediation_needed}" == "true" ]]; then
    echo
    echo "## Recovery Steps"
    echo
    echo "1. Install Docker Desktop or provide local \`postgres\`, \`redis-server\`, and \`minio\` binaries on this machine."
    echo "2. Verify the runtime is discoverable, or use \`PILOT_DEMO_RUNTIME_MODE=force_available\` only when the stack is already running and you want to bypass auto-detection."
    echo "3. Rerun \`npm run demo:pilot\` after local services are available."
    echo "4. If you only need the operator bundle and story links, rerun with \`DRY_RUN=1 npm run demo:pilot\`."
  fi
} > "${preflight_file}"

{
  echo "# Pilot Demo Runbook"
  echo
  echo "- Profile: \`${pilot_profile}\`"
  echo "- Evidence bundle: \`${bundle_dir}\`"
  echo "- Summary file: \`${summary_file}\`"
  echo "- Commands file: \`${commands_file}\`"
  echo "- Artifact manifest: \`${capture_manifest_file}\`"
  echo "- Machine manifest: \`${manifest_json_file}\`"
  echo "- Decision: \`${decision}\`"
  echo
  echo "## Surfaces"
  echo
  echo "- Demo command center: \`${demo_url}\`"
  echo "- Quick review: \`${quick_review_url}\`"
  echo "- Simulator workflow settings: \`${workflow_settings_url}\`"
  echo "- Expo launch URL: \`${expo_url}\`"
  echo "- Internal feed: \`${internal_feed_url}\`"
  echo
  echo "## Happy Path"
  echo
  echo "1. Open the demo command center."
  echo "2. Load the mobile poster workspace."
  echo "3. Create the demo post."
  echo "4. Open quick review or the full reviewer workspace."
  echo "5. Approve the post and land on the internal feed."
  echo
  echo "## Exception Paths"
  echo
  echo "1. Organization auto-approval: use simulator workflow settings to show the inherited low-risk internal photo path and the club exception that forces manual review."
  echo "2. Public video second approval: use simulator workflow settings to compare the organization requirement against the club override that removes the second approval step."
  echo
  echo "## Step Results"
  while IFS= read -r step_status; do
    [[ -n "${step_status}" ]] || continue
    echo "- ${step_status}"
  done < "${status_file}"
  if [[ "${remediation_needed}" == "true" ]]; then
    echo
    echo "## Recovery Steps"
    echo
    echo "1. Install Docker Desktop or provide local \`postgres\`, \`redis-server\`, and \`minio\` binaries."
    echo "2. Rerun \`npm run demo:pilot\` once the local runtime is available."
    echo "3. Use \`DRY_RUN=1 npm run demo:pilot\` when you only need a rehearsal bundle without starting services."
  fi
} > "${runbook_file}"

{
  echo "# Pilot Demo Evidence"
  echo
  echo "- Profile: \`${pilot_profile}\`"
  echo "- Bundle: \`${bundle_dir}\`"
  echo "- Decision: \`${decision}\`"
  echo
  echo "## Happy Path"
  echo
  echo "- Poster launch URL: \`${happy_path_post_url}\`"
  echo "- Reviewer surface: \`${happy_path_review_url}\`"
  echo "- Published output: \`${internal_feed_url}\`"
  echo
  echo "## Captured Artifacts"
  echo
  echo "- Manifest: \`${capture_manifest_file}\`"
  echo "- Machine manifest: \`${manifest_json_file}\`"
  if [[ "${DRY_RUN}" == "1" || "${can_launch_operator}" != "1" ]]; then
    echo "- Capture plan: \`${capture_plan_file}\`"
  else
    echo "- Demo command center HTML: \`${artifacts_dir}/demo-command-center.html\`"
    echo "- Quick review HTML: \`${artifacts_dir}/quick-review.html\`"
    echo "- Workflow settings HTML: \`${artifacts_dir}/workflow-settings.html\`"
    echo "- Auto-approval exception HTML: \`${artifacts_dir}/exception-auto-approval.html\`"
    echo "- Second-approval exception HTML: \`${artifacts_dir}/exception-second-approval.html\`"
    echo "- Internal feed JSON: \`${artifacts_dir}/internal-feed.json\`"
  fi
  echo
  echo "## Exception Path: Organization Auto-Approval"
  echo
  echo "- Scenario URL: \`${exception_auto_approval_url}\`"
  echo "- What it shows: low-risk internal photo inherits the organization auto-approval posture before a club exception changes the path."
  echo
  echo "## Exception Path: Public Video Second Approval"
  echo
  echo "- Scenario URL: \`${exception_second_approval_url}\`"
  echo "- What it shows: public video follows the organization second-approval rule until the club override removes that extra gate."
  echo
  echo "## Supporting Logs"
  echo
  echo "- Local app API: \`${api_output}\`"
  echo "- Local worker: \`${worker_output}\`"
  echo "- Service bootstrap: \`${services_output}\`"
  echo "- Simulator reset: \`${simulator_output}\`"
  echo "- Operator surfaces: \`${operator_output}\`"
  echo "- Operator admin log: \`${operator_admin_log}\`"
  echo "- Operator mobile log: \`${operator_mobile_log}\`"
  echo "- Surface opening: \`${open_output}\`"
  if [[ "${remediation_needed}" == "true" ]]; then
    echo
    echo "## Recovery Steps"
    echo
    echo "- Install Docker Desktop or local \`postgres\`, \`redis-server\`, and \`minio\` binaries before the next live demo attempt."
    echo "- Rerun \`npm run demo:pilot\` after the local runtime is available to replace this no-go bundle with a live rehearsal bundle."
    echo "- Use \`DRY_RUN=1 npm run demo:pilot\` if you need a shareable operator packet while runtime setup is still pending."
  fi
} > "${evidence_file}"

{
  printf '%s\n' "demo_command_center=${demo_url}"
  printf '%s\n' "quick_review=${quick_review_url}"
  printf '%s\n' "workflow_settings=${workflow_settings_url}"
  printf '%s\n' "happy_path_post=${happy_path_post_url}"
  printf '%s\n' "exception_auto_approval=${exception_auto_approval_url}"
  printf '%s\n' "exception_second_approval=${exception_second_approval_url}"
  printf '%s\n' "internal_feed=${internal_feed_url}"
} > "${links_file}"

cat > "${manifest_json_file}" <<EOF
{
  "profile": "$(printf '%s' "${pilot_profile}")",
  "decision": "$(printf '%s' "${decision}")",
  "runtimeMode": "$(printf '%s' "${RUNTIME_MODE}")",
  "localRuntimeAvailable": ${local_runtime_available},
  "dockerAvailable": ${docker_available},
  "paths": {
    "bundle": "$(printf '%s' "${bundle_dir}")",
    "summary": "$(printf '%s' "${summary_file}")",
    "status": "$(printf '%s' "${status_file}")",
    "commands": "$(printf '%s' "${commands_file}")",
    "runbook": "$(printf '%s' "${runbook_file}")",
    "evidence": "$(printf '%s' "${evidence_file}")",
    "preflight": "$(printf '%s' "${preflight_file}")",
    "links": "$(printf '%s' "${links_file}")",
    "artifactManifest": "$(printf '%s' "${capture_manifest_file}")",
    "capturePlan": "$(printf '%s' "${capture_plan_file}")",
    "serviceLog": "$(printf '%s' "${services_output}")",
    "apiLog": "$(printf '%s' "${api_output}")",
    "workerLog": "$(printf '%s' "${worker_output}")",
    "simulatorLog": "$(printf '%s' "${simulator_output}")",
    "operatorLog": "$(printf '%s' "${operator_output}")",
    "operatorAdminLog": "$(printf '%s' "${operator_admin_log}")",
    "operatorMobileLog": "$(printf '%s' "${operator_mobile_log}")",
    "openLog": "$(printf '%s' "${open_output}")",
    "artifactsLog": "$(printf '%s' "${artifacts_output}")"
  },
  "urls": {
    "demoCommandCenter": "$(printf '%s' "${demo_url}")",
    "quickReview": "$(printf '%s' "${quick_review_url}")",
    "workflowSettings": "$(printf '%s' "${workflow_settings_url}")",
    "happyPathPost": "$(printf '%s' "${happy_path_post_url}")",
    "exceptionAutoApproval": "$(printf '%s' "${exception_auto_approval_url}")",
    "exceptionSecondApproval": "$(printf '%s' "${exception_second_approval_url}")",
    "internalFeed": "$(printf '%s' "${internal_feed_url}")"
  }
}
EOF

log_line "pilot_demo_decision=${decision}"
if [[ "${decision}" == "NO_GO" ]]; then
  exit 1
fi

echo "pilot_demo_result=ok"
