#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
ORGANIZATION_SLUG="${ORGANIZATION_SLUG:-demo-sports-org}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
TEAM_SLUG="${TEAM_SLUG:-u14-girls}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
ORGANIZATION_ADMIN_EMAIL="${ORGANIZATION_ADMIN_EMAIL:-org-admin@demo-club.local}"
CLUB_ADMIN_EMAIL="${CLUB_ADMIN_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-auto-approval-rule-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

shell_quote() {
  printf "%q" "$1"
}

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS:-0}" != "1" ]]; then
  current_dir="$(pwd -P)"

  if [[ "${current_dir}" != "${REMOTE_DIR}" || ! -f "${COMPOSE_FILE}" ]]; then
    remote_dir_quoted="$(shell_quote "${REMOTE_DIR}")"
    remote_command=$(
      printf "cd %s && CLUB_CONTENT_SMOKE_ON_VPS=1 COMPOSE_FILE=%s ORGANIZATION_SLUG=%s CLUB_SLUG=%s TEAM_SLUG=%s SUBMITTER_EMAIL=%s ORGANIZATION_ADMIN_EMAIL=%s CLUB_ADMIN_EMAIL=%s TIMEOUT_SECONDS=%s POLL_SECONDS=%s SMOKE_MARKER=%s bash -s" \
        "${remote_dir_quoted}" \
        "$(shell_quote "${COMPOSE_FILE}")" \
        "$(shell_quote "${ORGANIZATION_SLUG}")" \
        "$(shell_quote "${CLUB_SLUG}")" \
        "$(shell_quote "${TEAM_SLUG}")" \
        "$(shell_quote "${SUBMITTER_EMAIL}")" \
        "$(shell_quote "${ORGANIZATION_ADMIN_EMAIL}")" \
        "$(shell_quote "${CLUB_ADMIN_EMAIL}")" \
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

echo "Applying organization auto-approval rule for smoke..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${ORGANIZATION_ADMIN_EMAIL}"'","autoApproveInternalLowRisk":true,"autoApproveMaxRisk":0.35,"autoApprovalRule":{"allowedContentTypes":["photo"]}}' \
  "http://localhost:4000/workflow-policies/organizations/${ORGANIZATION_SLUG}" >/dev/null

echo "Clearing club auto-approval overrides so the organization rule is authoritative..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","autoApproveInternalLowRisk":null,"autoApproveMaxRisk":null,"autoApprovalRule":null}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

echo "Creating auto-approval rule smoke submission: ${SMOKE_MARKER}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"photo","visibilityTarget":"internal","rawText":"'"${SMOKE_MARKER}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

submission_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
      s.status,
      COALESCE(ar.id::text, ''),
      COALESCE(s.routing_decision->>'autoApproved', ''),
      COALESCE(s.routing_decision->>'autoApproveReason', ''),
      COALESCE(pp.external_post_id, ''),
      COALESCE(pj.state::text, ''),
      COALESCE(se.processing_error, '')
    FROM submissions s
    LEFT JOIN approval_requests ar ON ar.submission_id = s.id
    LEFT JOIN LATERAL (
      SELECT external_post_id
      FROM published_posts
      WHERE submission_id = s.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pp ON TRUE
    LEFT JOIN LATERAL (
      SELECT state
      FROM publishing_jobs
      WHERE submission_id = s.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pj ON TRUE
    LEFT JOIN LATERAL (
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id
        AND event_name IN ('submission.created', 'submission.approved')
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.raw_text = '${SMOKE_MARKER}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r submission_id status approval_request_id auto_approved auto_approve_reason external_post_id publish_state processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed during auto-approval smoke for submission ${submission_id}: ${processing_error}" >&2
      exit 1
    fi

    if [[ -n "${approval_request_id}" ]]; then
      echo "Auto-approval rule smoke unexpectedly created approval request ${approval_request_id}." >&2
      exit 1
    fi

    if [[ "${status}" == "published" && "${auto_approved}" == "true" && "${auto_approve_reason}" == "policy_auto_approve_low_risk_internal" && "${publish_state}" == "succeeded" && -n "${external_post_id}" ]]; then
      detail_json="$(curl -fsS "http://localhost:4000/submissions/${submission_id}")"
      approved_event_payload="$(query_one "
        SELECT COALESCE(payload::text, '{}')
        FROM submission_events
        WHERE submission_id = '${submission_id}'
          AND event_name = 'submission.approved'
        ORDER BY created_at DESC
        LIMIT 1;
      ")"
      DETAIL_JSON="${detail_json}" APPROVED_EVENT_PAYLOAD="${approved_event_payload}" EXTERNAL_POST_ID="${external_post_id}" node <<'NODE'
const assert = require("node:assert/strict");

const detail = JSON.parse(process.env.DETAIL_JSON);
const approvedEvent = JSON.parse(process.env.APPROVED_EVENT_PAYLOAD || "{}");
const externalPostId = process.env.EXTERNAL_POST_ID;

assert.equal(detail.status, "published", "Submission detail did not reach published");
assert.equal(detail.latestApprovalRequest, null, "Auto-approved submission should not have an approval request");
assert.equal(detail.routing_decision?.autoApproved, true, "Routing decision autoApproved missing");
assert.equal(
  detail.routing_decision?.autoApproveReason,
  "policy_auto_approve_low_risk_internal",
  "Routing decision auto-approve reason mismatch"
);
assert.equal(
  detail.publishedPost?.destinationType,
  "internal_feed",
  "Published destination type mismatch"
);
assert.equal(
  detail.publishedPost?.externalPostId,
  externalPostId,
  "Published post id mismatch"
);
assert.equal(approvedEvent.autoApproved, true, "Approved event must mark autoApproved");
assert.equal(
  approvedEvent.autoApproveReason,
  "policy_auto_approve_low_risk_internal",
  "Approved event auto-approve reason mismatch"
);
NODE

      echo "Auto-approval rule smoke passed."
      echo "submission_id=${submission_id}"
      echo "status=${status}"
      echo "auto_approved=${auto_approved}"
      echo "auto_approve_reason=${auto_approve_reason}"
      echo "publish_state=${publish_state}"
      echo "external_post_id=${external_post_id}"
      exit 0
    fi

    echo "Waiting for auto-approved publish. status=${status:-pending} auto_approved=${auto_approved:-pending} publish_state=${publish_state:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

echo "Timed out waiting for auto-approved publish on ${SMOKE_MARKER}." >&2
exit 1
