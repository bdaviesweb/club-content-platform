#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"

ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && \
  curl -fsS http://localhost:4000/health && printf '\n---\n' && \
  curl -fsS http://localhost:4000/approvals/queue"
