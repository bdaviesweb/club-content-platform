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

ssh "${REMOTE_HOST}" /bin/bash -s -- \
  "${REMOTE_DIR}" \
  "${COMPOSE_FILE}" \
  "${CLUB_SLUG}" \
  "${TEAM_SLUG}" \
  "${SUBMITTER_EMAIL}" \
  "${REVIEWER_EMAIL}" \
  "${TIMEOUT_SECONDS}" \
  "${POLL_SECONDS}" \
  "${CLEANUP_APPROVAL}" \
  "${SMOKE_MARKER}" <<'INNER'
set -euo pipefail

REMOTE_DIR="$1"
COMPOSE_FILE="$2"
CLUB_SLUG="$3"
TEAM_SLUG="$4"
SUBMITTER_EMAIL="$5"
REVIEWER_EMAIL="$6"
TIMEOUT_SECONDS="$7"
POLL_SECONDS="$8"
CLEANUP_APPROVAL="$9"
SMOKE_MARKER="${10}"

cd "${REMOTE_DIR}"

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@" </dev/null
}

echo "Checking API health..."
curl -fsS http://localhost:4000/health
echo

echo "Checking AI review worker configuration..."
hermes_url=$(compose exec -T worker printenv HERMES_REVIEW_AGENT_URL || true)
if [[ -z "${hermes_url}" ]]; then
  echo "HERMES_REVIEW_AGENT_URL is not set in the worker container." >&2
  exit 1
fi

echo "Creating smoke submission: ${SMOKE_MARKER}"
submission_id=""
for attempt in 1 2 3 4 5; do
  submission_response=$(
    curl -fsS \
      -H "content-type: application/json" \
      -d "{\"clubSlug\":\"${CLUB_SLUG}\",\"teamSlug\":\"${TEAM_SLUG}\",\"submitterEmail\":\"${SUBMITTER_EMAIL}\",\"contentType\":\"photo\",\"visibilityTarget\":\"internal\",\"rawText\":\"${SMOKE_MARKER}\",\"media\":[]}" \
      http://localhost:4000/submissions 2>/dev/null || true
  )
  submission_id=$(printf '%s' "${submission_response}" | sed -n 's/.*"submission":{"id":"\([^"]*\)".*/\1/p')

  if [[ -n "${submission_id}" ]]; then
    break
  fi

  echo "Could not read the smoke submission id on attempt ${attempt}; retrying..."
  sleep "${POLL_SECONDS}"
done

if [[ -z "${submission_id}" ]]; then
  echo "Could not read the smoke submission id from the API response after retries." >&2
  exit 1
fi

echo "submission_id=${submission_id}"

deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row=$(compose exec -T postgres psql -U club -d club_content -At -F '|' -c "
    SELECT
      s.id,
      s.status,
      COALESCE(ar.id::text, ''),
      COALESCE(ar.state::text, ''),
      COALESCE(s.routing_decision->>'reviewMode', ''),
      COALESCE(s.routing_decision->>'routingSource', ''),
      COALESCE(s.routing_decision->>'approverRole', ''),
      COALESCE(s.routing_decision->>'localFallbackApproverRole', ''),
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
    WHERE s.id = '${submission_id}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")

  if [[ -n "${row}" ]]; then
    IFS='|' read -r submission_id status approval_request_id approval_state review_mode routing_source approver_role local_fallback_approver_role model summary processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed for submission ${submission_id}: ${processing_error}" >&2
      exit 1
    fi

    if [[ "${review_mode}" == "hermes" && "${routing_source}" == "hermes_agent" && ( "${CLEANUP_APPROVAL}" != "1" || -n "${approval_request_id}" ) ]]; then
      echo "AI review smoke passed."
      echo "submission_id=${submission_id}"
      echo "status=${status}"
      echo "approval_request_id=${approval_request_id}"
      echo "approval_state=${approval_state}"
      echo "review_mode=${review_mode}"
      echo "routing_source=${routing_source}"
      echo "approver_role=${approver_role}"
      echo "local_fallback_approver_role=${local_fallback_approver_role}"
      echo "model=${model}"
      echo "summary=${summary}"

      if [[ "${CLEANUP_APPROVAL}" == "1" ]]; then
        echo "Cleaning up smoke approval request..."
        curl -fsS \
          -H "content-type: application/json" \
          -d "{\"action\":\"request_changes\",\"actedByEmail\":\"${REVIEWER_EMAIL}\",\"notes\":\"AI review smoke cleanup.\"}" \
          "http://localhost:4000/approval-requests/${approval_request_id}/actions" >/dev/null
        echo "cleanup_action=request_changes"
      else
        echo "cleanup_action=skipped"
      fi
      exit 0
    fi

    echo "Waiting for AI review. status=${status:-pending} review_mode=${review_mode:-pending} routing_source=${routing_source:-pending} approval_request_id=${approval_request_id:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

echo "Timed out waiting for Hermes agent routing on ${SMOKE_MARKER}." >&2
exit 1
INNER
