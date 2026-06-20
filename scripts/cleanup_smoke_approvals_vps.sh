#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-comms@demo-club.local}"
APPLY="${APPLY:-0}"

ssh "${REMOTE_HOST}" /bin/bash <<INNER
set -euo pipefail

cd '${REMOTE_DIR}'

compose() {
  docker compose -f '${COMPOSE_FILE}' "\$@" </dev/null
}

query_smoke_approvals() {
  compose exec -T postgres psql -U club -d club_content -At -F '|' -c "
    SELECT
      ar.id,
      s.id,
      s.status,
      replace(left(s.raw_text, 120), E'\\n', '\\n') AS raw_text
    FROM approval_requests ar
    JOIN submissions s ON s.id = ar.submission_id
    WHERE ar.state = 'pending'
      AND (
        s.raw_text LIKE 'admin-review-smoke-%'
        OR s.raw_text LIKE 'hermes-smoke-%'
        OR s.raw_text LIKE 'approval-publish-smoke-%'
        OR s.raw_text LIKE 'approval-publish-smoke-mobile-qa-%'
        OR s.raw_text LIKE 'routing-rule-smoke-%'
        OR s.raw_text LIKE 'auto-approval-rule-smoke-%'
        OR s.raw_text LIKE 'auto-approval-override-smoke-%'
        OR s.raw_text LIKE 'approval-override-smoke-%'
        OR s.raw_text LIKE 'event-notification-rule-smoke-%'
        OR s.raw_text LIKE 'publishing-override-smoke-%'
        OR s.raw_text LIKE 'public-second-approval-smoke-%'
        OR s.raw_text LIKE 'hermes-diagnostic-%'
        OR s.raw_text LIKE 'E2E smoke review post%'
        OR s.raw_text LIKE 'E2E smoke post%'
        OR s.raw_text LIKE 'Approval action smoke%'
        OR s.raw_text LIKE 'mobile-demo-post-%'
      )
    ORDER BY ar.created_at ASC;
  "
}

rows="\$(query_smoke_approvals)"
if [[ -z "\${rows}" ]]; then
  echo "No pending smoke approvals found."
  exit 0
fi

if [[ '${APPLY}' != "1" ]]; then
  echo "Pending smoke approvals. Re-run with APPLY=1 to move these out of the active queue."
  echo "\${rows}" | while IFS='|' read -r approval_request_id submission_id status raw_text; do
    echo "approval_request_id=\${approval_request_id} submission_id=\${submission_id} status=\${status} raw_text=\${raw_text}"
  done
  exit 0
fi

echo "\${rows}" | while IFS='|' read -r approval_request_id submission_id status raw_text; do
  echo "Cleaning smoke approval \${approval_request_id} for submission \${submission_id}"
  curl -fsS \
    -H "content-type: application/json" \
    -d '{"action":"request_changes","actedByEmail":"${REVIEWER_EMAIL}","notes":"Smoke queue cleanup."}' \
    "http://localhost:4000/approval-requests/\${approval_request_id}/actions" >/dev/null
done

remaining="\$(query_smoke_approvals)"
if [[ -n "\${remaining}" ]]; then
  echo "Some pending smoke approvals remain:" >&2
  echo "\${remaining}" >&2
  exit 1
fi

echo "Smoke approval cleanup complete."
INNER
