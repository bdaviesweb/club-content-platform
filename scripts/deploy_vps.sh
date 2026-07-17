#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
SSH_OPTS="${SSH_OPTS:-}"
rsync_ssh_opts=()
if [[ -n "${SSH_OPTS}" ]]; then
  rsync_ssh_opts=(-e "ssh ${SSH_OPTS}")
fi

ssh_remote() {
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "$@"
}

echo "Preparing remote directory: ${REMOTE_DIR}"
ssh_remote "mkdir -p '${REMOTE_DIR}'"

echo "Syncing project to ${REMOTE_HOST}:${REMOTE_DIR}"
rsync -av \
  "${rsync_ssh_opts[@]}" \
  --delete \
  --exclude node_modules \
  --exclude data \
  --exclude .expo \
  --exclude .git \
  --exclude .env.vps \
  ./ "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "Ensuring VPS env file exists"
ssh_remote "cd '${REMOTE_DIR}' && if [ ! -f .env.vps ]; then cp .env.vps.example .env.vps; fi"

echo "Starting VPS stack"
ssh_remote "cd '${REMOTE_DIR}' && docker compose -f docker-compose.vps.yml up --build -d --remove-orphans"

echo "Done. Next check:"
echo "ssh ${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker compose -f docker-compose.vps.yml ps'"
echo "For day-to-day updates after GitHub pushes, use:"
echo "./scripts/update_vps.sh"
echo "For a quick deployed health snapshot, use:"
echo "./scripts/smoke_vps.sh"
echo "For the live dev notification contract, use:"
echo "./scripts/notification_status_smoke_vps.sh"
echo "For webhook intake verification, use:"
echo "./scripts/notification_webhook_smoke_vps.sh"
echo "For post-deploy QA, use:"
echo "RUN_APPROVAL_PUBLISH_SMOKE=1 RUN_ADMIN_REVIEW_SMOKE=1 ./scripts/update_vps.sh"
echo "Then run simulator QA locally when Metro and iOS Simulator are available:"
echo "CLEAN_SMOKE_APPROVALS=1 RUN_SIMULATOR_SMOKE=1 npm run qa:mobile"
