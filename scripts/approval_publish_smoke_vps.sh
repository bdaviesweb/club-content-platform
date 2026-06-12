#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
TEAM_SLUG="${TEAM_SLUG:-u14-girls}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"

SMOKE_MARKER="approval-publish-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"

ssh "${REMOTE_HOST}" /bin/bash <<INNER
set -euo pipefail

cd '${REMOTE_DIR}'

compose() {
  docker compose -f '${COMPOSE_FILE}' "\$@" </dev/null
}

query_one() {
  compose exec -T postgres psql -U club -d club_content -At -F '|' -c "\$1"
}

echo "Checking API health..."
curl -fsS http://localhost:4000/health
echo

echo "Creating approval publish smoke submission: ${SMOKE_MARKER}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"${CLUB_SLUG}","teamSlug":"${TEAM_SLUG}","submitterEmail":"${SUBMITTER_EMAIL}","contentType":"photo","visibilityTarget":"internal","rawText":"${SMOKE_MARKER}","media":[]}' \
  http://localhost:4000/submissions >/dev/null

submission_id=""
approval_request_id=""
deadline=\$((SECONDS + ${TIMEOUT_SECONDS}))
while (( SECONDS < deadline )); do
  row=\$(query_one "
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
      echo "Worker failed before approval for submission \${submission_id}: \${processing_error}" >&2
      exit 1
    fi

    if [[ -n "\${approval_request_id}" && "\${approval_state}" == "pending" ]]; then
      echo "Review ready."
      echo "submission_id=\${submission_id}"
      echo "approval_request_id=\${approval_request_id}"
      echo "review_mode=\${review_mode}"
      echo "model=\${model}"
      echo "summary=\${summary}"
      break
    fi

    echo "Waiting for approval request. status=\${status:-pending} review_mode=\${review_mode:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep '${POLL_SECONDS}'
done

if [[ -z "\${approval_request_id}" ]]; then
  echo "Timed out waiting for approval request on ${SMOKE_MARKER}." >&2
  exit 1
fi

echo "Approving smoke submission..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"${REVIEWER_EMAIL}","notes":"Approval publish smoke."}' \
  "http://localhost:4000/approval-requests/\${approval_request_id}/actions" >/dev/null

deadline=\$((SECONDS + ${TIMEOUT_SECONDS}))
while (( SECONDS < deadline )); do
  row=\$(query_one "
    SELECT
      s.status,
      COALESCE(ar.state::text, ''),
      COALESCE(pj.state::text, ''),
      COALESCE(pj.result_summary, ''),
      COALESCE(pp.external_post_id, ''),
      COALESCE(se.processing_error, '')
    FROM submissions s
    LEFT JOIN approval_requests ar ON ar.submission_id = s.id
    LEFT JOIN LATERAL (
      SELECT state, result_summary
      FROM publishing_jobs
      WHERE submission_id = s.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pj ON TRUE
    LEFT JOIN LATERAL (
      SELECT external_post_id
      FROM published_posts
      WHERE submission_id = s.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pp ON TRUE
    LEFT JOIN LATERAL (
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id AND event_name = 'submission.approved'
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.id = '\${submission_id}'
    LIMIT 1;
  ")

  IFS='|' read -r status approval_state publish_state result_summary external_post_id processing_error <<< "\${row}"

  if [[ -n "\${processing_error}" ]]; then
    echo "Worker failed after approval for submission \${submission_id}: \${processing_error}" >&2
    exit 1
  fi

  if [[ "\${status}" == "published" && "\${approval_state}" == "approved" && "\${publish_state}" == "succeeded" && -n "\${external_post_id}" ]]; then
    echo "Approval publish smoke passed."
    echo "submission_id=\${submission_id}"
    echo "approval_request_id=\${approval_request_id}"
    echo "status=\${status}"
    echo "approval_state=\${approval_state}"
    echo "publish_state=\${publish_state}"
    echo "external_post_id=\${external_post_id}"
    echo "result_summary=\${result_summary}"
    exit 0
  fi

  echo "Waiting for publish. status=\${status:-pending} approval_state=\${approval_state:-pending} publish_state=\${publish_state:-pending}"
  sleep '${POLL_SECONDS}'
done

echo "Timed out waiting for publish on submission \${submission_id}." >&2
exit 1
INNER
