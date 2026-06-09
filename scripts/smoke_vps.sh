#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev-zt}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"

ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && \
  curl -fsS http://localhost:4000/health && printf '\n---\n' && \
  curl -fsS http://localhost:4000/approvals/queue && printf '\n---\n' && \
  curl -fsS http://localhost:3002 -o /tmp/club-content-admin-smoke.html && \
  grep -q '<title>Content Ops' /tmp/club-content-admin-smoke.html && \
  curl -fsS http://localhost:3003 -o /tmp/club-content-mobile-smoke.html && \
  grep -q '<title>Club Content' /tmp/club-content-mobile-smoke.html"

curl -fsS https://clubcontent-api.davmn.net/health >/dev/null
review_html="$(mktemp)"
app_html="$(mktemp)"
trap 'rm -f "${review_html}" "${app_html}"' EXIT

curl -fsS https://review-clubcontent.davmn.net -o "${review_html}"
grep -q "<title>Content Ops" "${review_html}"

APP_EDGE_IP="$(dig @1.1.1.1 +short app-clubcontent.davmn.net | head -n 1)"
if [ -z "${APP_EDGE_IP}" ]; then
  echo "app-clubcontent.davmn.net did not resolve through 1.1.1.1" >&2
  exit 1
fi

curl -fsS --resolve "app-clubcontent.davmn.net:443:${APP_EDGE_IP}" \
  https://app-clubcontent.davmn.net -o "${app_html}"
grep -q "<title>Club Content" "${app_html}"

echo "VPS smoke passed"
