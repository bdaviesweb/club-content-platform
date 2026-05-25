#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
BRANCH="${BRANCH:-main}"

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
