#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev-zt}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"

ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && \
  docker compose -f docker-compose.vps.yml up -d postgres && \
  docker compose -f docker-compose.vps.yml exec -T postgres sh -lc 'until pg_isready -U club -d club_content; do sleep 1; done' && \
  for migration in db/migrations/*.sql; do \
    [ -e \"\$migration\" ] || continue; \
    echo \"Applying \$migration\"; \
    docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -v ON_ERROR_STOP=1 < \"\$migration\"; \
  done"
