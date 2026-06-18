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
SMOKE_MARKER="${SMOKE_MARKER:-approval-publish-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

is_smoke_raw_text() {
  local raw_text="${1:-}"
  [[ "${raw_text}" == admin-review-smoke-* ]] \
    || [[ "${raw_text}" == approval-publish-smoke-* ]] \
    || [[ "${raw_text}" == approval-publish-smoke-mobile-qa-* ]] \
    || [[ "${raw_text}" == hermes-smoke-* ]] \
    || [[ "${raw_text}" == hermes-diagnostic-* ]] \
    || [[ "${raw_text}" == "E2E smoke post"* ]] \
    || [[ "${raw_text}" == "Approval action smoke"* ]] \
    || [[ "${raw_text}" == mobile-demo-post-* ]]
}

shell_quote() {
  printf "%q" "$1"
}

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS:-0}" != "1" ]]; then
  current_dir="$(pwd -P)"

  if [[ "${current_dir}" != "${REMOTE_DIR}" || ! -f "${COMPOSE_FILE}" ]]; then
    remote_dir_quoted="$(shell_quote "${REMOTE_DIR}")"
    remote_command=$(
      printf "cd %s && CLUB_CONTENT_SMOKE_ON_VPS=1 COMPOSE_FILE=%s CLUB_SLUG=%s TEAM_SLUG=%s SUBMITTER_EMAIL=%s REVIEWER_EMAIL=%s TIMEOUT_SECONDS=%s POLL_SECONDS=%s SMOKE_MARKER=%s bash -s" \
        "${remote_dir_quoted}" \
        "$(shell_quote "${COMPOSE_FILE}")" \
        "$(shell_quote "${CLUB_SLUG}")" \
        "$(shell_quote "${TEAM_SLUG}")" \
        "$(shell_quote "${SUBMITTER_EMAIL}")" \
        "$(shell_quote "${REVIEWER_EMAIL}")" \
        "$(shell_quote "${TIMEOUT_SECONDS}")" \
        "$(shell_quote "${POLL_SECONDS}")" \
        "$(shell_quote "${SMOKE_MARKER}")"
    )

    exec ssh "${REMOTE_HOST}" "${remote_command}" < "$0"
  fi

  export CLUB_CONTENT_SMOKE_ON_VPS=1
fi

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@" </dev/null
}

query_one() {
  compose exec -T postgres psql -U club -d club_content -At -F '|' -c "$1"
}

echo "Checking API health..."
curl -fsS http://localhost:4000/health
echo

echo "Applying club override for manual review smoke..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${REVIEWER_EMAIL}"'","autoApproveInternalLowRisk":false,"autoApproveMaxRisk":0.35,"autoApprovalRule":{}}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

initial_queue_rows="$(query_one "
  SELECT
    COALESCE(ar.id::text, ''),
    COALESCE(s.id::text, ''),
    COALESCE(s.raw_text, '')
  FROM approval_requests ar
  JOIN submissions s ON s.id = ar.submission_id
  WHERE ar.state = 'pending'
  ORDER BY ar.created_at ASC;
")"

initial_queue_count=0
stale_smoke_rows=""
if [[ -n "${initial_queue_rows}" ]]; then
  while IFS='|' read -r queue_approval_request_id queue_submission_id queue_raw_text; do
    [[ -z "${queue_approval_request_id}" ]] && continue
    initial_queue_count=$((initial_queue_count + 1))
    if is_smoke_raw_text "${queue_raw_text}"; then
      stale_smoke_rows+="${queue_approval_request_id}|${queue_submission_id}|${queue_raw_text}"$'\n'
    fi
  done <<< "${initial_queue_rows}"
fi

if [[ -n "${stale_smoke_rows}" ]]; then
  echo "Pending smoke approvals already exist:" >&2
  printf '%s' "${stale_smoke_rows}" >&2
  echo "Clear them before running approval_publish_smoke_vps.sh." >&2
  exit 1
fi

echo "initial_queue_count=${initial_queue_count}"

echo "Creating approval publish smoke submission: ${SMOKE_MARKER}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"photo","visibilityTarget":"internal","rawText":"'"${SMOKE_MARKER}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

submission_id=""
approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row=$(query_one "
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

  if [[ -n "${row}" ]]; then
    IFS='|' read -r submission_id status approval_request_id approval_state review_mode model summary processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed before approval for submission ${submission_id}: ${processing_error}" >&2
      exit 1
    fi

    if [[ -n "${approval_request_id}" && "${approval_state}" == "pending" ]]; then
      echo "Review ready."
      echo "submission_id=${submission_id}"
      echo "approval_request_id=${approval_request_id}"
      echo "review_mode=${review_mode}"
      echo "model=${model}"
      echo "summary=${summary}"
      break
    fi

    echo "Waiting for approval request. status=${status:-pending} review_mode=${review_mode:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

if [[ -z "${approval_request_id}" ]]; then
  echo "Timed out waiting for approval request on ${SMOKE_MARKER}." >&2
  exit 1
fi

echo "Approving smoke submission..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"'"${REVIEWER_EMAIL}"'","notes":"Approval publish smoke."}' \
  "http://localhost:4000/approval-requests/${approval_request_id}/actions" >/dev/null

deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row=$(query_one "
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
    WHERE s.id = '${submission_id}'
    LIMIT 1;
  ")

  IFS='|' read -r status approval_state publish_state result_summary external_post_id processing_error <<< "${row}"

  if [[ -n "${processing_error}" ]]; then
    echo "Worker failed after approval for submission ${submission_id}: ${processing_error}" >&2
    exit 1
  fi

  if [[ "${status}" == "published" && "${approval_state}" == "approved" && "${publish_state}" == "succeeded" && -n "${external_post_id}" ]]; then
    detail_json="$(curl -fsS "http://localhost:4000/submissions/${submission_id}")"
    published_event_payload="$(query_one "
      SELECT COALESCE(payload::text, '')
      FROM submission_events
      WHERE submission_id = '${submission_id}'
        AND event_name = 'submission.published'
      ORDER BY created_at DESC
      LIMIT 1;
    ")"
    DETAIL_JSON="${detail_json}" SUBMISSION_ID="${submission_id}" EXTERNAL_POST_ID="${external_post_id}" node <<'NODE'
const assert = require("node:assert/strict");

const detail = JSON.parse(process.env.DETAIL_JSON);
const submissionId = process.env.SUBMISSION_ID;
const externalPostId = process.env.EXTERNAL_POST_ID;

assert.equal(detail.id, submissionId, "Unexpected submission detail id");
assert.equal(detail.status, "published", "Submission detail did not reach published");
assert.equal(detail.publishedPost?.externalPostId, externalPostId, "Published post id mismatch");
assert.equal(detail.publishedPost?.destinationType, "internal_feed", "Destination type mismatch");
assert.equal(detail.publishedPost?.destinationName, "Internal Club Feed", "Destination name mismatch");
assert.ok(detail.publishedPost?.publishedAt, "Published timestamp missing");
assert.ok(detail.latestReviewRun?.summary, "Latest review summary missing");
assert.ok(detail.latestApprovalRequest?.id, "Latest approval request missing");
assert.equal(detail.latestApprovalRequest?.state, "approved", "Approval request state mismatch");
assert.ok(detail.routing_decision?.reviewMode, "Routing decision review mode missing");
assert.ok(detail.routing_decision?.routingSource, "Routing decision source missing");
NODE
    PUBLISHED_EVENT_PAYLOAD="${published_event_payload}" node <<'NODE'
const assert = require("node:assert/strict");

const payload = JSON.parse(process.env.PUBLISHED_EVENT_PAYLOAD || "{}");

assert.equal(typeof payload.destinationCount, "number", "Published event destinationCount missing");
assert.ok(payload.destinationCount >= 1, "Published event destinationCount must be at least 1");
assert.ok(Array.isArray(payload.destinations), "Published event destinations missing");
assert.equal(
  payload.destinations.length,
  payload.destinationCount,
  "Published event destination count mismatch"
);
assert.equal(
  payload.destinations[0]?.destinationType,
  payload.destinationType,
  "Primary destination type mismatch"
);
assert.equal(
  payload.destinations[0]?.destinationName,
  payload.destinationName,
  "Primary destination name mismatch"
);
NODE

    echo "Approval publish smoke passed."
    echo "submission_id=${submission_id}"
    echo "approval_request_id=${approval_request_id}"
    echo "status=${status}"
    echo "approval_state=${approval_state}"
    echo "publish_state=${publish_state}"
    echo "external_post_id=${external_post_id}"
    echo "result_summary=${result_summary}"
    echo "detail_destination=${detail_json}" | node -e '
const fs = require("node:fs");
const line = fs.readFileSync(0, "utf8").trim().replace(/^detail_destination=/, "");
const detail = JSON.parse(line);
console.log(`detail_destination=${detail.publishedPost.destinationName}`);
console.log(`detail_routing_source=${detail.routing_decision.routingSource}`);
console.log(`detail_review_mode=${detail.routing_decision.reviewMode}`);
'
    echo "published_event_destination_count=${published_event_payload}" | node -e '
const fs = require("node:fs");
const line = fs.readFileSync(0, "utf8").trim().replace(/^published_event_destination_count=/, "");
const payload = JSON.parse(line);
console.log(`published_event_destination_count=${payload.destinationCount}`);
console.log(`published_event_primary_type=${payload.destinationType}`);
'
    final_queue_count=$(query_one "
      SELECT COUNT(*)
      FROM approval_requests
      WHERE state = 'pending';
    ")
    echo "final_queue_count=${final_queue_count}"
    if (( final_queue_count > initial_queue_count )); then
      echo "Approval queue grew during smoke: initial=${initial_queue_count} final=${final_queue_count}" >&2
      exit 1
    fi
    exit 0
  fi

  echo "Waiting for publish. status=${status:-pending} approval_state=${approval_state:-pending} publish_state=${publish_state:-pending}"
  sleep "${POLL_SECONDS}"
done

echo "Timed out waiting for publish on submission ${submission_id}." >&2
exit 1
