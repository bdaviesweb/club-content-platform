#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
SSH_OPTS="${SSH_OPTS:-}"
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

extract_output_value() {
  local key="$1"
  local output="$2"

  printf '%s\n' "${output}" | node -e '
const fs = require("node:fs");
const key = process.argv[1];
const lines = fs.readFileSync(0, "utf8").split(/\r?\n/);
for (const line of lines) {
  if (line.startsWith(key + "=")) {
    process.stdout.write(line.slice(key.length + 1));
    process.exit(0);
  }
}
process.exit(1);
' "${key}"
}

echo "Deploying current checkout to ${REMOTE_HOST}:${REMOTE_DIR}"
REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/deploy_vps.sh

echo
echo "---"
if [[ "${CLEAN_SMOKE_APPROVALS}" == "1" ]]; then
  echo "Cleaning stale smoke approvals"
  REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" APPLY=1 ./scripts/cleanup_smoke_approvals_vps.sh
  echo
  echo "---"
fi

echo "Running baseline VPS route smoke"
REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/smoke_vps.sh

echo
echo "---"
echo "Running routing rule smoke"
run_checked_step "Routing rule smoke" env REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/routing_rule_smoke_vps.sh

echo
echo "---"
echo "Running auto-approval rule smoke"
run_checked_step "Auto-approval rule smoke" env REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/auto_approval_rule_smoke_vps.sh

echo
echo "---"
echo "Running auto-approval override smoke"
run_checked_step "Auto-approval override smoke" env REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/auto_approval_override_smoke_vps.sh

echo
echo "---"
echo "Running approval publish smoke"
approval_publish_output="$(
  REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/approval_publish_smoke_vps.sh
)"
printf '%s\n' "${approval_publish_output}"

submission_id=""
if submission_id="$(extract_output_value "submission_id" "${approval_publish_output}")"; then
  :
else
  echo "Approval publish smoke did not report submission_id."
  exit 1
fi

echo
echo "---"
echo "Running publishing override smoke"
run_checked_step "Publishing override smoke" env REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/publishing_override_smoke_vps.sh

echo
echo "---"
echo "Running public second approval smoke"
public_second_approval_output="$(
  env REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/public_second_approval_smoke_vps.sh
)"
printf '%s\n' "${public_second_approval_output}"

public_submission_id=""
if public_submission_id="$(extract_output_value "submission_id" "${public_second_approval_output}")"; then
  :
else
  echo "Public second approval smoke did not report submission_id."
  exit 1
fi

echo
echo "---"
echo "Running approval override smoke"
run_checked_step "Approval override smoke" env REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/approval_override_smoke_vps.sh

echo
echo "---"
echo "Running event notification rule smoke"
run_checked_step "Event notification rule smoke" env REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" SSH_OPTS="${SSH_OPTS}" ./scripts/event_notification_rule_smoke_vps.sh

echo
echo "---"
echo "Running notification status smoke"
run_checked_step "Notification status smoke" env REMOTE_HOST="${REMOTE_HOST}" SSH_OPTS="${SSH_OPTS}" ./scripts/notification_status_smoke_vps.sh

if [[ "${RUN_NOTIFICATION_DEEP_SMOKE}" == "1" ]]; then
  echo
  echo "---"
  echo "Running notification readback smoke"
  run_checked_step "Notification readback smoke" env REMOTE_HOST="${REMOTE_HOST}" SSH_OPTS="${SSH_OPTS}" EXPECTED_SUBMISSION_ID="${public_submission_id}" EXPECTED_EMAIL_REASON="notification_policy_email_disabled" EXPECTED_PUSH_REASON="notification_policy_push_disabled" ./scripts/notification_smoke_vps.sh
fi

if [[ "${RUN_NOTIFICATION_WEBHOOK_SMOKE}" == "1" ]]; then
  echo
  echo "---"
  echo "Running notification webhook smoke"
  run_checked_step "Notification webhook smoke" env REMOTE_HOST="${REMOTE_HOST}" SSH_OPTS="${SSH_OPTS}" ./scripts/notification_webhook_smoke_vps.sh
fi

echo
echo "---"
echo "VPS weekly loop verification passed."
