#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
RUN_NOTIFICATION_WEBHOOK_SMOKE="${RUN_NOTIFICATION_WEBHOOK_SMOKE:-1}"
RUN_NOTIFICATION_DEEP_SMOKE="${RUN_NOTIFICATION_DEEP_SMOKE:-1}"
CLEAN_SMOKE_APPROVALS="${CLEAN_SMOKE_APPROVALS:-1}"

run_checked_step() {
  local label="$1"
  shift

  local output
  if ! output="$("$@" 2>&1)"; then
    printf '%s\n' "${output}"
    echo "${label} failed."
    return 1
  fi

  if [[ -z "${output//[$' \t\r\n']/}" ]]; then
    echo "${label} produced no output."
    return 1
  fi

  printf '%s\n' "${output}"
}

echo "Deploying current checkout to ${REMOTE_HOST}:${REMOTE_DIR}"
REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" ./scripts/deploy_vps.sh

echo
echo "---"
if [[ "${CLEAN_SMOKE_APPROVALS}" == "1" ]]; then
  echo "Cleaning stale smoke approvals"
  REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" APPLY=1 ./scripts/cleanup_smoke_approvals_vps.sh
  echo
  echo "---"
fi

echo "Running baseline VPS route smoke"
REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" ./scripts/smoke_vps.sh

echo
echo "---"
echo "Running approval publish smoke"
REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" ./scripts/approval_publish_smoke_vps.sh

echo
echo "---"
echo "Running notification status smoke"
run_checked_step "Notification status smoke" env REMOTE_HOST="${REMOTE_HOST}" ./scripts/notification_status_smoke_vps.sh

if [[ "${RUN_NOTIFICATION_DEEP_SMOKE}" == "1" ]]; then
  echo
  echo "---"
  echo "Running notification readback smoke"
  run_checked_step "Notification readback smoke" env REMOTE_HOST="${REMOTE_HOST}" ./scripts/notification_smoke_vps.sh
fi

if [[ "${RUN_NOTIFICATION_WEBHOOK_SMOKE}" == "1" ]]; then
  echo
  echo "---"
  echo "Running notification webhook smoke"
  run_checked_step "Notification webhook smoke" env REMOTE_HOST="${REMOTE_HOST}" ./scripts/notification_webhook_smoke_vps.sh
fi

echo
echo "---"
echo "VPS weekly loop verification passed."
