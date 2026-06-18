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
SMOKE_MARKER="${SMOKE_MARKER:-auto-approval-override-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

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

assert_org_default_auto_approval_policy() {
  local policy_json="$1"

  POLICY_JSON="${policy_json}" node <<'NODE'
const assert = require("node:assert/strict");
const policy = JSON.parse(process.env.POLICY_JSON);

assert.equal(policy.organizationPolicy?.autoApproveInternalLowRisk, true);
assert.equal(policy.clubPolicy?.autoApproveInternalLowRisk, null);
assert.equal(policy.effectivePolicy?.autoApproveInternalLowRisk, true);
assert.equal(
  policy.effectivePolicy?.autoApprovalRule?.allowedContentTypes?.[0],
  "photo"
);
NODE
}

assert_club_override_auto_approval_policy() {
  local policy_json="$1"

  POLICY_JSON="${policy_json}" node <<'NODE'
const assert = require("node:assert/strict");
const policy = JSON.parse(process.env.POLICY_JSON);

assert.equal(policy.organizationPolicy?.autoApproveInternalLowRisk, true);
assert.equal(policy.clubPolicy?.autoApproveInternalLowRisk, false);
assert.equal(policy.effectivePolicy?.autoApproveInternalLowRisk, false);
NODE
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

assert_org_default_auto_approval_policy "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")"

org_marker="${SMOKE_MARKER}"
echo "Creating organization-default auto-approval smoke submission: ${org_marker}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"photo","visibilityTarget":"internal","rawText":"'"${org_marker}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

org_submission_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
      s.status,
      COALESCE(ar.id::text, ''),
      COALESCE(s.routing_decision->>'autoApproved', ''),
      COALESCE(s.routing_decision->>'autoApproveReason', ''),
      COALESCE(pj.state::text, ''),
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
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id
        AND event_name IN ('submission.created', 'submission.approved')
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.raw_text = '${org_marker}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r org_submission_id status approval_request_id auto_approved auto_approve_reason publish_state processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed during organization-default auto-approval smoke for submission ${org_submission_id}: ${processing_error}" >&2
      exit 1
    fi

    if [[ -z "${approval_request_id}" && "${status}" == "published" && "${auto_approved}" == "true" && "${auto_approve_reason}" == "policy_auto_approve_low_risk_internal" && "${publish_state}" == "succeeded" ]]; then
      echo "Organization-default auto-approval smoke passed."
      echo "org_submission_id=${org_submission_id}"
      echo "org_auto_approve_reason=${auto_approve_reason}"
      echo "phase=organization_default"
      break
    fi

    echo "Waiting for organization-default auto-approved publish. status=${status:-pending} auto_approved=${auto_approved:-pending} publish_state=${publish_state:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

if [[ -z "${org_submission_id}" ]]; then
  echo "Timed out waiting for organization-default auto-approved publish on ${org_marker}." >&2
  exit 1
fi

club_marker="${SMOKE_MARKER}-club-override"
echo "Applying club override to disable auto-approval..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","autoApproveInternalLowRisk":false,"autoApproveMaxRisk":0.35,"autoApprovalRule":{}}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

assert_club_override_auto_approval_policy "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")"

echo "Creating club-override auto-approval smoke submission: ${club_marker}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"photo","visibilityTarget":"internal","rawText":"'"${club_marker}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

club_submission_id=""
club_approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
      s.status,
      COALESCE(ar.id::text, ''),
      COALESCE(ar.state::text, ''),
      COALESCE(s.routing_decision->>'autoApproved', ''),
      COALESCE(s.routing_decision->>'autoApproveReason', ''),
      COALESCE(se.processing_error, '')
    FROM submissions s
    LEFT JOIN approval_requests ar ON ar.submission_id = s.id
    LEFT JOIN LATERAL (
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id
        AND event_name = 'submission.created'
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.raw_text = '${club_marker}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r club_submission_id status club_approval_request_id approval_state auto_approved auto_approve_reason processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed during club-override auto-approval smoke for submission ${club_submission_id}: ${processing_error}" >&2
      exit 1
    fi

    if [[ -n "${club_approval_request_id}" && "${approval_state}" == "pending" ]]; then
      echo "Club override auto-approval smoke passed."
      echo "club_submission_id=${club_submission_id}"
      echo "club_approval_request_id=${club_approval_request_id}"
      echo "club_auto_approved=${auto_approved:-}"
      echo "club_auto_approve_reason=${auto_approve_reason:-}"
      echo "phase=club_override"

      curl -fsS \
        -H "content-type: application/json" \
        -d '{"action":"request_changes","actedByEmail":"'"${REVIEWER_EMAIL}"'","notes":"Club override auto-approval smoke cleanup."}' \
        "http://localhost:4000/approval-requests/${club_approval_request_id}/actions" >/dev/null
      exit 0
    fi

    echo "Waiting for club-override manual review. status=${status:-pending} approval_state=${approval_state:-pending}"
  else
    echo "Waiting for club override smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

echo "Timed out waiting for club-override manual review on ${club_marker}." >&2
exit 1
