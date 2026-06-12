#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
BRANCH="${BRANCH:-main}"
RUN_APPROVAL_PUBLISH_SMOKE="${RUN_APPROVAL_PUBLISH_SMOKE:-0}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-300}"

cd "${REPO_DIR}"

echo "Pulling latest ${BRANCH} in ${REPO_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

if [ ! -f .env.vps ]; then
  cp .env.vps.example .env.vps
fi

echo "Rebuilding and starting VPS stack"
docker compose -f "${COMPOSE_FILE}" up --build -d

echo "Health check"
curl -fsS http://localhost:4000/health
printf '\n---\n'
curl -fsS http://localhost:4000/approvals/queue

if [ "${RUN_APPROVAL_PUBLISH_SMOKE}" = "1" ]; then
  echo
  echo "---"
  echo "Running approval publish smoke"
  TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS}" ./scripts/approval_publish_smoke_vps.sh
fi
