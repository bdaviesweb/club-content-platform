#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev-zt}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"

ssh "${REMOTE_HOST}" "REPO_DIR='${REMOTE_DIR}' bash '${REMOTE_DIR}/scripts/pull_and_restart_vps.sh'"
