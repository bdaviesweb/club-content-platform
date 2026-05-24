#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev-zt}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"

echo "Preparing remote directory: ${REMOTE_DIR}"
ssh "${REMOTE_HOST}" "mkdir -p '${REMOTE_DIR}'"

echo "Syncing project to ${REMOTE_HOST}:${REMOTE_DIR}"
rsync -av \
  --delete \
  --exclude node_modules \
  --exclude data \
  --exclude .expo \
  --exclude .git \
  ./ "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "Ensuring VPS env file exists"
ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && if [ ! -f .env.vps ]; then cp .env.vps.example .env.vps; fi"

echo "Starting VPS stack"
ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && docker compose -f docker-compose.vps.yml up --build -d"

echo "Done. Next check:"
echo "ssh ${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker compose -f docker-compose.vps.yml ps'"
