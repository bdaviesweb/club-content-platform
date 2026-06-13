#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
RUN_APPROVAL_PUBLISH_SMOKE="${RUN_APPROVAL_PUBLISH_SMOKE:-0}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-300}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-60}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-2}"
DETACH="${DETACH:-0}"

remote_env="REPO_DIR='${REMOTE_DIR}' RUN_APPROVAL_PUBLISH_SMOKE='${RUN_APPROVAL_PUBLISH_SMOKE}' SMOKE_TIMEOUT_SECONDS='${SMOKE_TIMEOUT_SECONDS}' HEALTH_TIMEOUT_SECONDS='${HEALTH_TIMEOUT_SECONDS}' HEALTH_POLL_SECONDS='${HEALTH_POLL_SECONDS}'"
remote_script="'${REMOTE_DIR}/scripts/pull_and_restart_vps.sh'"

if [ "${DETACH}" = "1" ]; then
  ssh "${REMOTE_HOST}" "
    cd '${REMOTE_DIR}'
    log=\"/tmp/club-content-update-\$(date -u +%Y%m%dT%H%M%SZ).log\"
    nohup env ${remote_env} bash ${remote_script} </dev/null >\"\${log}\" 2>&1 &
    echo \"update_log=\${log}\"
    echo \"tail_command=ssh ${REMOTE_HOST} 'tail -f \${log}'\"
  "
  exit 0
fi

ssh "${REMOTE_HOST}" "${remote_env} bash ${remote_script}"
