#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
TEAM_SLUG="${TEAM_SLUG:-u14-girls}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
PRIMARY_REVIEWER_EMAIL="${PRIMARY_REVIEWER_EMAIL:-comms@demo-club.local}"
SECOND_REVIEWER_EMAIL="${SECOND_REVIEWER_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-approval-publish-smoke-public-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

shell_quote() {
  printf "%q" "$1"
}

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS:-0}" != "1" ]]; then
  current_dir="$(pwd -P)"

  if [[ "${current_dir}" != "${REMOTE_DIR}" || ! -f "${COMPOSE_FILE}" ]]; then
    remote_dir_quoted="$(shell_quote "${REMOTE_DIR}")"
    remote_command=$(
      printf "cd %s && CLUB_CONTENT_SMOKE_ON_VPS=1 COMPOSE_FILE=%s CLUB_SLUG=%s TEAM_SLUG=%s SUBMITTER_EMAIL=%s PRIMARY_REVIEWER_EMAIL=%s SECOND_REVIEWER_EMAIL=%s TIMEOUT_SECONDS=%s POLL_SECONDS=%s SMOKE_MARKER=%s bash -s" \
        "${remote_dir_quoted}" \
        "$(shell_quote "${COMPOSE_FILE}")" \
        "$(shell_quote "${CLUB_SLUG}")" \
        "$(shell_quote "${TEAM_SLUG}")" \
        "$(shell_quote "${SUBMITTER_EMAIL}")" \
        "$(shell_quote "${PRIMARY_REVIEWER_EMAIL}")" \
        "$(shell_quote "${SECOND_REVIEWER_EMAIL}")" \
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

echo "Creating public second-approval smoke submission: ${SMOKE_MARKER}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"photo","visibilityTarget":"public","rawText":"'"${SMOKE_MARKER}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

submission_id=""
primary_approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
      s.status,
      COALESCE(ar.id::text, ''),
      COALESCE(ar.stage::text, ''),
      COALESCE(ar.state::text, '')
    FROM submissions s
    LEFT JOIN LATERAL (
      SELECT id, stage, state
      FROM approval_requests
      WHERE submission_id = s.id
      ORDER BY created_at ASC
      LIMIT 1
    ) ar ON TRUE
    WHERE s.raw_text = '${SMOKE_MARKER}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r submission_id status primary_approval_request_id primary_stage primary_state <<< "${row}"

    if [[ -n "${primary_approval_request_id}" && "${primary_stage}" == "primary" && "${primary_state}" == "pending" ]]; then
      echo "Primary review ready."
      echo "submission_id=${submission_id}"
      echo "primary_approval_request_id=${primary_approval_request_id}"
      break
    fi

    echo "Waiting for primary approval. status=${status:-pending} primary_stage=${primary_stage:-pending} primary_state=${primary_state:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

if [[ -z "${primary_approval_request_id}" ]]; then
  echo "Timed out waiting for primary approval request on ${SMOKE_MARKER}." >&2
  exit 1
fi

echo "Approving primary review..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"'"${PRIMARY_REVIEWER_EMAIL}"'","notes":"Primary approval smoke."}' \
  "http://localhost:4000/approval-requests/${primary_approval_request_id}/actions" >/dev/null

secondary_approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.status,
      COALESCE(primary_ar.state::text, ''),
      COALESCE(secondary_ar.id::text, ''),
      COALESCE(secondary_ar.stage::text, ''),
      COALESCE(secondary_ar.state::text, ''),
      COALESCE(secondary_ar.approver_role::text, '')
    FROM submissions s
    LEFT JOIN LATERAL (
      SELECT state
      FROM approval_requests
      WHERE submission_id = s.id AND stage = 'primary'
      ORDER BY created_at ASC
      LIMIT 1
    ) primary_ar ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, stage, state, approver_role
      FROM approval_requests
      WHERE submission_id = s.id AND stage = 'secondary'
      ORDER BY created_at DESC
      LIMIT 1
    ) secondary_ar ON TRUE
    WHERE s.id = '${submission_id}'
    LIMIT 1;
  ")"

  IFS='|' read -r status primary_state secondary_approval_request_id secondary_stage secondary_state secondary_role <<< "${row}"

  if [[ -n "${secondary_approval_request_id}" && "${secondary_stage}" == "secondary" && "${secondary_state}" == "pending" ]]; then
    echo "Secondary review ready."
    echo "secondary_approval_request_id=${secondary_approval_request_id}"
    echo "secondary_approver_role=${secondary_role}"
    break
  fi

  echo "Waiting for secondary approval. status=${status:-pending} primary_state=${primary_state:-pending} secondary_state=${secondary_state:-pending}"
  sleep "${POLL_SECONDS}"
done

if [[ -z "${secondary_approval_request_id}" ]]; then
  echo "Timed out waiting for secondary approval request on ${submission_id}." >&2
  exit 1
fi

echo "Approving secondary review..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"'"${SECOND_REVIEWER_EMAIL}"'","notes":"Secondary approval smoke."}' \
  "http://localhost:4000/approval-requests/${secondary_approval_request_id}/actions" >/dev/null

deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.status,
      COALESCE(primary_ar.state::text, ''),
      COALESCE(secondary_ar.state::text, ''),
      COALESCE(pp.external_post_id, '')
    FROM submissions s
    LEFT JOIN LATERAL (
      SELECT state
      FROM approval_requests
      WHERE submission_id = s.id AND stage = 'primary'
      ORDER BY created_at ASC
      LIMIT 1
    ) primary_ar ON TRUE
    LEFT JOIN LATERAL (
      SELECT state
      FROM approval_requests
      WHERE submission_id = s.id AND stage = 'secondary'
      ORDER BY created_at DESC
      LIMIT 1
    ) secondary_ar ON TRUE
    LEFT JOIN LATERAL (
      SELECT external_post_id
      FROM published_posts
      WHERE submission_id = s.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pp ON TRUE
    WHERE s.id = '${submission_id}'
    LIMIT 1;
  ")"

  IFS='|' read -r status primary_state secondary_state external_post_id <<< "${row}"

  if [[ "${status}" == "published" && "${primary_state}" == "approved" && "${secondary_state}" == "approved" && -n "${external_post_id}" ]]; then
    event_payloads="$(query_one "
      SELECT event_name, COALESCE(payload::text, '{}')
      FROM submission_events
      WHERE submission_id = '${submission_id}'
        AND event_name IN ('submission.approval.requested', 'submission.approved')
      ORDER BY created_at ASC;
    ")"
    EVENT_PAYLOADS="${event_payloads}" node <<'NODE'
const assert = require("node:assert/strict");

const rows = String(process.env.EVENT_PAYLOADS || "")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [eventName, payload] = line.split("|");
    return { eventName, payload: JSON.parse(payload || "{}") };
  });

const secondaryRequested = rows.find(
  (row) =>
    row.eventName === "submission.approval.requested" &&
    row.payload.stage === "secondary"
);
const finalApproved = rows.find(
  (row) =>
    row.eventName === "submission.approved" &&
    row.payload.stage === "secondary"
);

assert.ok(secondaryRequested, "Missing secondary approval requested event");
assert.equal(
  secondaryRequested.payload.previousApprovalRequestId ? typeof secondaryRequested.payload.previousApprovalRequestId : "missing",
  "string",
  "Secondary approval event missing previousApprovalRequestId"
);
assert.ok(finalApproved, "Missing final secondary approval event");
NODE

    echo "Public second approval smoke passed."
    echo "submission_id=${submission_id}"
    echo "primary_approval_request_id=${primary_approval_request_id}"
    echo "secondary_approval_request_id=${secondary_approval_request_id}"
    echo "status=${status}"
    echo "primary_state=${primary_state}"
    echo "secondary_state=${secondary_state}"
    echo "external_post_id=${external_post_id}"
    exit 0
  fi

  echo "Waiting for publish after second approval. status=${status:-pending} primary_state=${primary_state:-pending} secondary_state=${secondary_state:-pending}"
  sleep "${POLL_SECONDS}"
done

echo "Timed out waiting for publish after second approval on submission ${submission_id}." >&2
exit 1
