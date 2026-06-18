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
REVIEWER_EMAIL="${REVIEWER_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-publishing-override-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

shell_quote() {
  printf "%q" "$1"
}

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS:-0}" != "1" ]]; then
  current_dir="$(pwd -P)"

  if [[ "${current_dir}" != "${REMOTE_DIR}" || ! -f "${COMPOSE_FILE}" ]]; then
    remote_dir_quoted="$(shell_quote "${REMOTE_DIR}")"
    remote_command=$(
      printf "cd %s && CLUB_CONTENT_SMOKE_ON_VPS=1 COMPOSE_FILE=%s ORGANIZATION_SLUG=%s CLUB_SLUG=%s TEAM_SLUG=%s SUBMITTER_EMAIL=%s ORGANIZATION_ADMIN_EMAIL=%s CLUB_ADMIN_EMAIL=%s REVIEWER_EMAIL=%s TIMEOUT_SECONDS=%s POLL_SECONDS=%s SMOKE_MARKER=%s bash -s" \
        "${remote_dir_quoted}" \
        "$(shell_quote "${COMPOSE_FILE}")" \
        "$(shell_quote "${ORGANIZATION_SLUG}")" \
        "$(shell_quote "${CLUB_SLUG}")" \
        "$(shell_quote "${TEAM_SLUG}")" \
        "$(shell_quote "${SUBMITTER_EMAIL}")" \
        "$(shell_quote "${ORGANIZATION_ADMIN_EMAIL}")" \
        "$(shell_quote "${CLUB_ADMIN_EMAIL}")" \
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

assert_org_default_publishing_policy() {
  local policy_json="$1"

  POLICY_JSON="${policy_json}" node <<'NODE'
const assert = require("node:assert/strict");

const policy = JSON.parse(process.env.POLICY_JSON);

assert.equal(
  policy.organizationPolicy?.publishingRule?.visibilityDestinations?.internal?.[0],
  "internal_feed",
  "Organization publishing rule should target internal_feed for internal visibility"
);
assert.equal(
  policy.clubPolicy?.publishingRule,
  null,
  "Club publishing override should be cleared for the organization-default phase"
);
assert.equal(
  policy.effectivePolicy?.publishingRule?.visibilityDestinations?.internal?.[0],
  "internal_feed",
  "Effective publishing rule should inherit the organization visibility rule"
);
NODE
}

assert_club_override_publishing_policy() {
  local policy_json="$1"

  POLICY_JSON="${policy_json}" node <<'NODE'
const assert = require("node:assert/strict");

const policy = JSON.parse(process.env.POLICY_JSON);

assert.equal(
  policy.clubPolicy?.publishingRule?.destinations?.[0],
  "internal_feed",
  "Club publishing override should set fallback destinations"
);
assert.equal(
  policy.effectivePolicy?.publishingRule?.destinations?.[0],
  "internal_feed",
  "Effective publishing rule should use the club fallback destinations"
);
assert.equal(
  policy.effectivePolicy?.publishingRule?.visibilityDestinations,
  undefined,
  "Club publishing override should replace organization visibility destinations"
);
NODE
}

assert_published_policy_source() {
  local detail_json="$1"
  local published_event_payload="$2"
  local expected_policy_source="$3"
  local submission_id="$4"

  DETAIL_JSON="${detail_json}" \
  PUBLISHED_EVENT_PAYLOAD="${published_event_payload}" \
  EXPECTED_POLICY_SOURCE="${expected_policy_source}" \
  SUBMISSION_ID="${submission_id}" \
  node <<'NODE'
const assert = require("node:assert/strict");

const detail = JSON.parse(process.env.DETAIL_JSON);
const payload = JSON.parse(process.env.PUBLISHED_EVENT_PAYLOAD || "{}");
const expectedPolicySource = process.env.EXPECTED_POLICY_SOURCE;
const submissionId = process.env.SUBMISSION_ID;

assert.equal(detail.id, submissionId, "Unexpected submission detail id");
assert.equal(detail.status, "published", "Submission detail did not reach published");
assert.equal(detail.publishedPost?.destinationType, "internal_feed", "Destination type mismatch");
assert.ok(detail.publishedPost?.externalPostId, "Published post id missing");
assert.equal(payload.policySource, expectedPolicySource, "Published event policy source mismatch");
assert.equal(payload.destinationType, "internal_feed", "Published event destination type mismatch");
assert.ok(Array.isArray(payload.destinations), "Published event destinations missing");
assert.ok(payload.destinations.length >= 1, "Published event destinations must not be empty");
NODE
}

wait_for_approval_request() {
  local marker="$1"
  local submission_id_var="$2"
  local approval_request_id_var="$3"

  local submission_id=""
  local approval_request_id=""
  local deadline=$((SECONDS + TIMEOUT_SECONDS))

  while (( SECONDS < deadline )); do
    local row
    row="$(query_one "
      SELECT
        s.id,
        s.status,
        COALESCE(ar.id::text, ''),
        COALESCE(ar.state::text, ''),
        COALESCE(se.processing_error, '')
      FROM submissions s
      LEFT JOIN approval_requests ar ON ar.submission_id = s.id
      LEFT JOIN LATERAL (
        SELECT processing_error
        FROM submission_events
        WHERE submission_id = s.id AND event_name = 'submission.created'
        ORDER BY created_at DESC
        LIMIT 1
      ) se ON TRUE
      WHERE s.raw_text = '${marker}'
      ORDER BY s.created_at DESC
      LIMIT 1;
    ")"

    if [[ -n "${row}" ]]; then
      local status approval_state processing_error
      IFS='|' read -r submission_id status approval_request_id approval_state processing_error <<< "${row}"

      if [[ -n "${processing_error}" ]]; then
        echo "Worker failed before approval for submission ${submission_id}: ${processing_error}" >&2
        exit 1
      fi

      if [[ -n "${approval_request_id}" && "${approval_state}" == "pending" ]]; then
        printf -v "${submission_id_var}" '%s' "${submission_id}"
        printf -v "${approval_request_id_var}" '%s' "${approval_request_id}"
        return 0
      fi

      echo "Waiting for approval request. status=${status:-pending}"
    else
      echo "Waiting for smoke submission to appear..."
    fi

    sleep "${POLL_SECONDS}"
  done

  echo "Timed out waiting for approval request on ${marker}." >&2
  exit 1
}

wait_for_publish() {
  local submission_id="$1"
  local expected_policy_source="$2"
  local phase_label="$3"

  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    local row
    row="$(query_one "
      SELECT
        s.status,
        COALESCE(ar.state::text, ''),
        COALESCE(pj.state::text, ''),
        COALESCE(pp.external_post_id, ''),
        COALESCE(se.processing_error, '')
      FROM submissions s
      LEFT JOIN approval_requests ar ON ar.submission_id = s.id
      LEFT JOIN LATERAL (
        SELECT state
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
    ")"

    local status approval_state publish_state external_post_id processing_error
    IFS='|' read -r status approval_state publish_state external_post_id processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed after approval for submission ${submission_id}: ${processing_error}" >&2
      exit 1
    fi

    if [[ "${status}" == "published" && "${approval_state}" == "approved" && "${publish_state}" == "succeeded" && -n "${external_post_id}" ]]; then
      local detail_json
      local published_event_payload
      detail_json="$(curl -fsS "http://localhost:4000/submissions/${submission_id}")"
      published_event_payload="$(query_one "
        SELECT COALESCE(payload::text, '')
        FROM submission_events
        WHERE submission_id = '${submission_id}'
          AND event_name = 'submission.published'
        ORDER BY created_at DESC
        LIMIT 1;
      ")"

      assert_published_policy_source \
        "${detail_json}" \
        "${published_event_payload}" \
        "${expected_policy_source}" \
        "${submission_id}"

      echo "${phase_label} publish passed."
      echo "${phase_label}_submission_id=${submission_id}"
      echo "${phase_label}_external_post_id=${external_post_id}"
      echo "${phase_label}_policy_source=${expected_policy_source}"
      return 0
    fi

    echo "Waiting for publish. status=${status:-pending} approval_state=${approval_state:-pending} publish_state=${publish_state:-pending}"
    sleep "${POLL_SECONDS}"
  done

  echo "Timed out waiting for publish on submission ${submission_id}." >&2
  exit 1
}

echo "Checking API health..."
curl -fsS http://localhost:4000/health
echo

echo "Applying club override for manual review smoke..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${REVIEWER_EMAIL}"'","autoApproveInternalLowRisk":false,"autoApproveMaxRisk":0.35,"autoApprovalRule":{}}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

echo "Applying organization visibility publish rule for internal content..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${ORGANIZATION_ADMIN_EMAIL}"'","publishingRule":{"visibilityDestinations":{"internal":["internal_feed"],"public":["internal_feed"]}}}' \
  "http://localhost:4000/workflow-policies/organizations/${ORGANIZATION_SLUG}" >/dev/null

echo "Clearing club publishing override so the organization rule is authoritative..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","publishingRule":null}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

assert_org_default_publishing_policy "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")"

org_marker="${SMOKE_MARKER}"
echo "Creating organization-default publishing smoke submission: ${org_marker}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"photo","visibilityTarget":"internal","rawText":"'"${org_marker}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

org_submission_id=""
org_approval_request_id=""
wait_for_approval_request "${org_marker}" org_submission_id org_approval_request_id

echo "Approving organization-default publish smoke submission..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"'"${REVIEWER_EMAIL}"'","notes":"Organization-default publishing smoke."}' \
  "http://localhost:4000/approval-requests/${org_approval_request_id}/actions" >/dev/null

wait_for_publish "${org_submission_id}" "publishing_rule_visibility_internal" "org_default"
echo "phase=organization_default"

club_marker="${SMOKE_MARKER}-club-override"
echo "Applying club publishing override to replace organization visibility rules..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","publishingRule":{"destinations":["internal_feed"]}}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

assert_club_override_publishing_policy "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")"

echo "Creating club-override publishing smoke submission: ${club_marker}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"photo","visibilityTarget":"internal","rawText":"'"${club_marker}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

club_submission_id=""
club_approval_request_id=""
wait_for_approval_request "${club_marker}" club_submission_id club_approval_request_id

echo "Approving club-override publish smoke submission..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"'"${REVIEWER_EMAIL}"'","notes":"Club-override publishing smoke."}' \
  "http://localhost:4000/approval-requests/${club_approval_request_id}/actions" >/dev/null

wait_for_publish "${club_submission_id}" "publishing_rule_destinations" "club_override"
echo "phase=club_override"
