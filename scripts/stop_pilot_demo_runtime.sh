#!/usr/bin/env bash
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
runtime_root="${PILOT_DEMO_RUNTIME_ROOT:-${HOME}/.club-content-pilot-runtime}"
runtime_state_root="${PILOT_DEMO_RUNTIME_STATE_ROOT:-${runtime_root}/state}"
bundle_root="${PILOT_DEMO_BUNDLE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tmp/pilot-demo}"
bundle_runtime_root="${PILOT_DEMO_BUNDLE_RUNTIME_ROOT:-${bundle_root}/runtime}"
postgres_data_dir="${runtime_state_root}/postgres/data"
redis_pid_file="${runtime_state_root}/redis/redis.pid"
minio_pid_file="${runtime_state_root}/minio/minio.pid"
operator_pid_glob="${bundle_root}"/*/logs/operator-server.pid

log() {
  printf '%s\n' "$1"
}

run_cmd() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "DRY_RUN $*"
    return 0
  fi

  "$@"
}

kill_pid_file() {
  local label="$1"
  local pid_file="$2"

  if [[ ! -f "${pid_file}" ]]; then
    log "${label}=missing"
    return 0
  fi

  local pid
  pid="$(tr -d '[:space:]' < "${pid_file}")"
  if [[ -z "${pid}" ]]; then
    log "${label}=empty"
    return 0
  fi

  if [[ "${DRY_RUN}" == "1" ]]; then
    log "DRY_RUN kill ${pid} (${label})"
    return 0
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    log "${label}=stopped"
  else
    log "${label}=not-running"
  fi
}

kill_port_listener() {
  local label="$1"
  local port="$2"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN -n -P 2>/dev/null || true)"

  if [[ -z "${pids}" ]]; then
    log "${label}_port_${port}=missing"
    return 0
  fi

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    if [[ "${DRY_RUN}" == "1" ]]; then
      log "DRY_RUN kill ${pid} (${label}_port_${port})"
    else
      kill "${pid}" 2>/dev/null || true
      log "${label}_port_${port}=stopped"
    fi
  done <<< "${pids}"
}

wait_for_port_to_close() {
  local label="$1"
  local port="$2"
  local attempts="${3:-20}"
  local sleep_seconds="${4:-1}"

  for ((i = 0; i < attempts; i += 1)); do
    if ! lsof -iTCP:"${port}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
      log "${label}_port_${port}=closed"
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  log "${label}_port_${port}=still-listening"
  return 1
}

log "pilot_demo_runtime_root=${runtime_root}"
log "pilot_demo_runtime_state_root=${runtime_state_root}"

if [[ -f "${bundle_runtime_root}/pilot-demo-api.pid" ]]; then
  kill_pid_file "api" "${bundle_runtime_root}/pilot-demo-api.pid"
else
  log "api=missing"
fi

if [[ -f "${bundle_runtime_root}/pilot-demo-worker.pid" ]]; then
  kill_pid_file "worker" "${bundle_runtime_root}/pilot-demo-worker.pid"
else
  log "worker=missing"
fi

shopt -s nullglob
operator_pid_files=(${operator_pid_glob})
shopt -u nullglob
if (( ${#operator_pid_files[@]} == 0 )); then
  log "operator=missing"
else
  for pid_file in "${operator_pid_files[@]}"; do
    kill_pid_file "operator" "${pid_file}"
  done
fi

if [[ -d "${postgres_data_dir}" ]]; then
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "DRY_RUN pg_ctl -D ${postgres_data_dir} stop -m fast"
  else
    if command -v pg_ctl >/dev/null 2>&1; then
      pg_ctl -D "${postgres_data_dir}" stop -m fast >/dev/null 2>&1 || true
      log "postgres=stopped"
    else
      log "postgres=pg_ctl-missing"
    fi
  fi
else
  log "postgres=missing"
fi

kill_pid_file "redis" "${redis_pid_file}"
kill_pid_file "minio" "${minio_pid_file}"

kill_port_listener "api" 4000
kill_port_listener "admin" 3013
kill_port_listener "metro" 8082

if [[ "${DRY_RUN}" != "1" ]]; then
  wait_for_port_to_close "api" 4000 || true
  wait_for_port_to_close "admin" 3013 || true
  wait_for_port_to_close "metro" 8082 || true
fi
