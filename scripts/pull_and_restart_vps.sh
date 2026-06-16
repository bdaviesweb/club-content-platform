#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
BRANCH="${BRANCH:-main}"
RUN_APPROVAL_PUBLISH_SMOKE="${RUN_APPROVAL_PUBLISH_SMOKE:-0}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-300}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-60}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-2}"

cd "${REPO_DIR}"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty; creating an autostash before pull"
  git stash push --include-untracked -m "autostash before pull_and_restart_vps $(date -u +%Y%m%dT%H%M%SZ)"
fi

echo "Pulling latest ${BRANCH} in ${REPO_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

if [ ! -f .env.vps ]; then
  cp .env.vps.example .env.vps
fi

echo "Rebuilding and starting VPS stack"
docker compose -f "${COMPOSE_FILE}" up --build -d --remove-orphans

echo "Health check"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until curl -fsS http://localhost:4000/health; do
  if (( SECONDS >= deadline )); then
    echo "API health check timed out after ${HEALTH_TIMEOUT_SECONDS}s." >&2
    exit 1
  fi
  echo "Waiting for API health..."
  sleep "${HEALTH_POLL_SECONDS}"
done
printf '\n---\n'
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until curl -fsS http://localhost:4000/approvals/queue; do
  if (( SECONDS >= deadline )); then
    echo "Approval queue check timed out after ${HEALTH_TIMEOUT_SECONDS}s." >&2
    exit 1
  fi
  echo "Waiting for approval queue..."
  sleep "${HEALTH_POLL_SECONDS}"
done

if [ "${RUN_APPROVAL_PUBLISH_SMOKE}" = "1" ]; then
  echo
  echo "---"
  echo "Running approval publish smoke"
  TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS}" ./scripts/approval_publish_smoke_vps.sh
fi
