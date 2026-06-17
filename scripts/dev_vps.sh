#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"

echo "Syncing current checkout to ${REMOTE_HOST}:${REMOTE_DIR}"
REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" ./scripts/deploy_vps.sh

echo
echo "Checking remote health"
REMOTE_HOST="${REMOTE_HOST}" REMOTE_DIR="${REMOTE_DIR}" ./scripts/smoke_vps.sh
ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && printf '\n---\n' && docker compose -f docker-compose.vps.yml ps"

echo
echo "VPS stack is live at:"
echo "  API:    https://clubcontent-api.davmn.net"
echo "  Uploads: https://clubcontent-uploads.davmn.net"
