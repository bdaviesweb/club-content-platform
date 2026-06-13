#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
TEAM_SLUG="${TEAM_SLUG:-u14-girls}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-90}"
POLL_SECONDS="${POLL_SECONDS:-3}"
CLEANUP_APPROVAL="${CLEANUP_APPROVAL:-1}"

SMOKE_MARKER="hermes-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"

ssh "${REMOTE_HOST}" /bin/bash <<INNER
set -euo pipefail

cd '${REMOTE_DIR}'

compose() {
  docker compose -f '${COMPOSE_FILE}' "\$@" </dev/null
}

echo "Checking API health..."
curl -fsS http://localhost:4000/health
echo

echo "Checking AI review worker configuration..."
hermes_url=\$(compose exec -T worker printenv HERMES_REVIEW_AGENT_URL || true)
if [[ -z "\${hermes_url}" ]]; then
  echo "HERMES_REVIEW_AGENT_URL is not set in the worker container." >&2
  exit 1
fi

echo "Creating smoke submission: ${SMOKE_MARKER}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"${CLUB_SLUG}","teamSlug":"${TEAM_SLUG}","submitterEmail":"${SUBMITTER_EMAIL}","contentType":"photo","visibilityTarget":"internal","rawText":"${SMOKE_MARKER}","media":[]}' \
  http://localhost:4000/submissions >/dev/null

deadline=\$((SECONDS + ${TIMEOUT_SECONDS}))
while (( SECONDS < deadline )); do
  row=\$(compose exec -T postgres psql -U club -d club_content -At -F '|' -c "
    SELECT
      s.id,
      s.status,
      COALESCE(ar.id::text, ''),
      COALESCE(ar.state::text, ''),
      COALESCE(s.routing_decision->>'reviewMode', ''),
      COALESCE(rr.model, ''),
      COALESCE(rr.summary, ''),
      COALESCE(se.processing_error, '')
    FROM submissions s
    LEFT JOIN approval_requests ar ON ar.submission_id = s.id
    LEFT JOIN LATERAL (
      SELECT model, summary
      FROM review_runs
      WHERE submission_id = s.id AND agent_name = 'moderation-agent'
      ORDER BY created_at DESC
      LIMIT 1
    ) rr ON TRUE
    LEFT JOIN LATERAL (
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id AND event_name = 'submission.created'
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.raw_text = '${SMOKE_MARKER}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")

  if [[ -n "\${row}" ]]; then
    IFS='|' read -r submission_id status approval_request_id approval_state review_mode model summary processing_error <<< "\${row}"

    if [[ -n "\${processing_error}" ]]; then
      echo "Worker failed for submission \${submission_id}: \${processing_error}" >&2
      exit 1
    fi

    if [[ "\${review_mode}" == "hermes" && ( '${CLEANUP_APPROVAL}' != "1" || -n "\${approval_request_id}" ) ]]; then
      echo "AI review smoke passed."
      echo "submission_id=\${submission_id}"
      echo "status=\${status}"
      echo "approval_request_id=\${approval_request_id}"
      echo "approval_state=\${approval_state}"
      echo "review_mode=\${review_mode}"
      echo "model=\${model}"
      echo "summary=\${summary}"

      if [[ '${CLEANUP_APPROVAL}' == "1" ]]; then
        echo "Cleaning up smoke approval request..."
        curl -fsS \
          -H "content-type: application/json" \
          -d '{"action":"request_changes","actedByEmail":"${REVIEWER_EMAIL}","notes":"AI review smoke cleanup."}' \
          "http://localhost:4000/approval-requests/\${approval_request_id}/actions" >/dev/null
        echo "cleanup_action=request_changes"
      else
        echo "cleanup_action=skipped"
      fi
      exit 0
    fi

    echo "Waiting for AI review. status=\${status:-pending} review_mode=\${review_mode:-pending} approval_request_id=\${approval_request_id:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep '${POLL_SECONDS}'
done

echo "Timed out waiting for AI review mode on ${SMOKE_MARKER}." >&2
exit 1
INNER
