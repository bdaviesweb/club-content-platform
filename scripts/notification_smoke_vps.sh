#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev-zt}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"

ssh "${REMOTE_HOST}" /bin/bash <<INNER
set -euo pipefail
cd '${REMOTE_DIR}'
curl -fsS http://localhost:4000/notification-delivery/status
echo ---
curl -fsS "http://localhost:4000/notifications?userEmail=${SUBMITTER_EMAIL}&limit=5"
echo ---
docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -c "select action, metadata->>'type' as type, metadata->'delivery'->>'channel' as channel, metadata->'delivery'->>'mode' as mode, metadata->'delivery'->>'reason' as reason, metadata->>'tokenCount' as push_tokens, created_at from audit_logs where entity_type='notification' order by created_at desc limit 10;"
INNER
