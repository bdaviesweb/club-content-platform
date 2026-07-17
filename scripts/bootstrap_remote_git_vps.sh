#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
REPO_URL="${REPO_URL:-git@github.com:bdaviesweb/club-content-platform.git}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-90}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-3}"

if [[ -z "${REMOTE_HOST}" ]]; then
  echo "Set REMOTE_HOST to the production VPS SSH target." >&2
  echo "Example: REMOTE_HOST=prod-vps ./scripts/bootstrap_remote_git_vps.sh" >&2
  exit 1
fi

ssh "${REMOTE_HOST}" \
  "REMOTE_DIR='${REMOTE_DIR}' REPO_URL='${REPO_URL}' BRANCH='${BRANCH}' COMPOSE_FILE='${COMPOSE_FILE}' HEALTH_TIMEOUT_SECONDS='${HEALTH_TIMEOUT_SECONDS}' HEALTH_POLL_SECONDS='${HEALTH_POLL_SECONDS}' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "git is required on the VPS." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required on the VPS." >&2
  exit 1
fi

mkdir -p "$(dirname "${REMOTE_DIR}")"

if [[ ! -d "${REMOTE_DIR}/.git" ]]; then
  if [[ -e "${REMOTE_DIR}" && -n "$(find "${REMOTE_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "Remote directory exists but is not a Git checkout: ${REMOTE_DIR}" >&2
    echo "Move it aside or set REMOTE_DIR to an empty path before bootstrapping." >&2
    exit 1
  fi
  echo "Cloning ${REPO_URL} into ${REMOTE_DIR}"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${REMOTE_DIR}"
fi

cd "${REMOTE_DIR}"

echo "Fetching ${BRANCH}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

if [[ ! -f .env.vps ]]; then
  cp .env.vps.example .env.vps
  echo "Created .env.vps from .env.vps.example; review secrets before production traffic." >&2
fi

echo "Starting stack"
docker compose -f "${COMPOSE_FILE}" up --build -d --remove-orphans

echo "Waiting for API health"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until curl -fsS http://localhost:4000/health; do
  if (( SECONDS >= deadline )); then
    echo "API health check timed out after ${HEALTH_TIMEOUT_SECONDS}s." >&2
    docker compose -f "${COMPOSE_FILE}" ps >&2
    exit 1
  fi
  sleep "${HEALTH_POLL_SECONDS}"
done

printf '\n---\n'
docker compose -f "${COMPOSE_FILE}" ps

printf '\n---\n'
CLUB_CONTENT_SMOKE_ON_VPS=1 ./scripts/smoke_vps.sh
REMOTE_SCRIPT
