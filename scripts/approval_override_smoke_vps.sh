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
PRIMARY_REVIEWER_EMAIL="${PRIMARY_REVIEWER_EMAIL:-comms@demo-club.local}"
SECOND_REVIEWER_EMAIL="${SECOND_REVIEWER_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-approval-override-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

shell_quote() {
  printf "%q" "$1"
}

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS:-0}" != "1" ]]; then
  current_dir="$(pwd -P)"

  if [[ "${current_dir}" != "${REMOTE_DIR}" || ! -f "${COMPOSE_FILE}" ]]; then
    remote_dir_quoted="$(shell_quote "${REMOTE_DIR}")"
    remote_command=$(
      printf "cd %s && CLUB_CONTENT_SMOKE_ON_VPS=1 COMPOSE_FILE=%s ORGANIZATION_SLUG=%s CLUB_SLUG=%s TEAM_SLUG=%s SUBMITTER_EMAIL=%s ORGANIZATION_ADMIN_EMAIL=%s CLUB_ADMIN_EMAIL=%s PRIMARY_REVIEWER_EMAIL=%s SECOND_REVIEWER_EMAIL=%s TIMEOUT_SECONDS=%s POLL_SECONDS=%s SMOKE_MARKER=%s bash -s" \
        "${remote_dir_quoted}" \
        "$(shell_quote "${COMPOSE_FILE}")" \
        "$(shell_quote "${ORGANIZATION_SLUG}")" \
        "$(shell_quote "${CLUB_SLUG}")" \
        "$(shell_quote "${TEAM_SLUG}")" \
        "$(shell_quote "${SUBMITTER_EMAIL}")" \
        "$(shell_quote "${ORGANIZATION_ADMIN_EMAIL}")" \
        "$(shell_quote "${CLUB_ADMIN_EMAIL}")" \
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

assert_org_default_approval_policy() {
  local policy_json="$1"

  POLICY_JSON="${policy_json}" node <<'NODE'
const assert = require("node:assert/strict");
const policy = JSON.parse(process.env.POLICY_JSON);

assert.equal(
  policy.organizationPolicy?.approvalRule?.requireSecondApprovalForPublic,
  true
);
assert.equal(
  policy.clubPolicy?.approvalRule,
  null
);
assert.equal(
  policy.effectivePolicy?.approvalRule?.requireSecondApprovalForPublic,
  true
);
NODE
}

assert_club_override_approval_policy() {
  local policy_json="$1"

  POLICY_JSON="${policy_json}" node <<'NODE'
const assert = require("node:assert/strict");
const policy = JSON.parse(process.env.POLICY_JSON);

assert.equal(
  policy.organizationPolicy?.approvalRule?.requireSecondApprovalForPublic,
  true
);
assert.equal(
  policy.clubPolicy?.approvalRule?.requireSecondApprovalForPublic,
  false
);
assert.equal(
  policy.effectivePolicy?.approvalRule?.requireSecondApprovalForPublic,
  false
);
NODE
}

echo "Checking API health..."
curl -fsS http://localhost:4000/health
echo

echo "Applying organization second-approval rule for public video..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${ORGANIZATION_ADMIN_EMAIL}"'","approvalRule":{"requireSecondApprovalForPublic":true,"secondApproverRole":"club_admin","secondApprovalContentTypes":["video"]}}' \
  "http://localhost:4000/workflow-policies/organizations/${ORGANIZATION_SLUG}" >/dev/null

echo "Clearing club approval override so the organization rule is authoritative..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","approvalRule":null}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

assert_org_default_approval_policy "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")"

org_marker="${SMOKE_MARKER}"
echo "Creating organization-default approval smoke submission: ${org_marker}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"video","visibilityTarget":"public","rawText":"'"${org_marker}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

org_submission_id=""
org_primary_approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
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
    WHERE s.raw_text = '${org_marker}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r org_submission_id org_primary_approval_request_id primary_stage primary_state <<< "${row}"
    if [[ -n "${org_primary_approval_request_id}" && "${primary_stage}" == "primary" && "${primary_state}" == "pending" ]]; then
      break
    fi
    echo "Waiting for organization-default primary approval. stage=${primary_stage:-pending} state=${primary_state:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi
  sleep "${POLL_SECONDS}"
done

if [[ -z "${org_primary_approval_request_id}" ]]; then
  echo "Timed out waiting for organization-default primary approval on ${org_marker}." >&2
  exit 1
fi

curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"'"${PRIMARY_REVIEWER_EMAIL}"'","notes":"Organization-default approval smoke."}' \
  "http://localhost:4000/approval-requests/${org_primary_approval_request_id}/actions" >/dev/null

org_secondary_approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      COALESCE(secondary_ar.id::text, ''),
      COALESCE(secondary_ar.stage::text, ''),
      COALESCE(secondary_ar.state::text, '')
    FROM submissions s
    LEFT JOIN LATERAL (
      SELECT id, stage, state
      FROM approval_requests
      WHERE submission_id = s.id AND stage = 'secondary'
      ORDER BY created_at DESC
      LIMIT 1
    ) secondary_ar ON TRUE
    WHERE s.id = '${org_submission_id}'
    LIMIT 1;
  ")"

  IFS='|' read -r org_secondary_approval_request_id secondary_stage secondary_state <<< "${row}"
  if [[ -n "${org_secondary_approval_request_id}" && "${secondary_stage}" == "secondary" && "${secondary_state}" == "pending" ]]; then
    echo "Organization-default approval smoke passed."
    echo "org_submission_id=${org_submission_id}"
    echo "org_secondary_approval_request_id=${org_secondary_approval_request_id}"
    echo "phase=organization_default"
    break
  fi
  echo "Waiting for organization-default secondary approval. stage=${secondary_stage:-pending} state=${secondary_state:-pending}"
  sleep "${POLL_SECONDS}"
done

if [[ -z "${org_secondary_approval_request_id}" ]]; then
  echo "Timed out waiting for organization-default secondary approval on ${org_submission_id}." >&2
  exit 1
fi

curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"request_changes","actedByEmail":"'"${SECOND_REVIEWER_EMAIL}"'","notes":"Organization-default approval smoke cleanup."}' \
  "http://localhost:4000/approval-requests/${org_secondary_approval_request_id}/actions" >/dev/null

club_marker="${SMOKE_MARKER}-club-override"
echo "Applying club override to disable second approval..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","approvalRule":{"requireSecondApprovalForPublic":false}}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

assert_club_override_approval_policy "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")"

echo "Creating club-override approval smoke submission: ${club_marker}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"video","visibilityTarget":"public","rawText":"'"${club_marker}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

club_submission_id=""
club_primary_approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
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
    WHERE s.raw_text = '${club_marker}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r club_submission_id club_primary_approval_request_id primary_stage primary_state <<< "${row}"
    if [[ -n "${club_primary_approval_request_id}" && "${primary_stage}" == "primary" && "${primary_state}" == "pending" ]]; then
      break
    fi
    echo "Waiting for club-override primary approval. stage=${primary_stage:-pending} state=${primary_state:-pending}"
  else
    echo "Waiting for club override smoke submission to appear..."
  fi
  sleep "${POLL_SECONDS}"
done

if [[ -z "${club_primary_approval_request_id}" ]]; then
  echo "Timed out waiting for club-override primary approval on ${club_marker}." >&2
  exit 1
fi

curl -fsS \
  -H "content-type: application/json" \
  -d '{"action":"approve","actedByEmail":"'"${PRIMARY_REVIEWER_EMAIL}"'","notes":"Club-override approval smoke."}' \
  "http://localhost:4000/approval-requests/${club_primary_approval_request_id}/actions" >/dev/null

deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.status,
      COALESCE(primary_ar.state::text, ''),
      COALESCE(secondary_ar.id::text, ''),
      COALESCE(pp.external_post_id, ''),
      COALESCE(se.processing_error, '')
    FROM submissions s
    LEFT JOIN LATERAL (
      SELECT state
      FROM approval_requests
      WHERE submission_id = s.id AND stage = 'primary'
      ORDER BY created_at ASC
      LIMIT 1
    ) primary_ar ON TRUE
    LEFT JOIN LATERAL (
      SELECT id
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
    LEFT JOIN LATERAL (
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id AND event_name = 'submission.approved'
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.id = '${club_submission_id}'
    LIMIT 1;
  ")"

  IFS='|' read -r status primary_state secondary_approval_request_id external_post_id processing_error <<< "${row}"

  if [[ -n "${processing_error}" ]]; then
    echo "Worker failed during club-override approval smoke for submission ${club_submission_id}: ${processing_error}" >&2
    exit 1
  fi

  if [[ "${status}" == "published" && "${primary_state}" == "approved" && -z "${secondary_approval_request_id}" && -n "${external_post_id}" ]]; then
    echo "Club override approval smoke passed."
    echo "club_submission_id=${club_submission_id}"
    echo "club_external_post_id=${external_post_id}"
    echo "phase=club_override"
    exit 0
  fi

  echo "Waiting for club-override direct publish. status=${status:-pending} primary_state=${primary_state:-pending}"
  sleep "${POLL_SECONDS}"
done

echo "Timed out waiting for club-override direct publish on ${club_submission_id}." >&2
exit 1
