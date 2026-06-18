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
TEAM_MANAGER_EMAIL="${TEAM_MANAGER_EMAIL:-coach@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-180}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-routing-rule-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

shell_quote() {
  printf "%q" "$1"
}

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS:-0}" != "1" ]]; then
  current_dir="$(pwd -P)"

  if [[ "${current_dir}" != "${REMOTE_DIR}" || ! -f "${COMPOSE_FILE}" ]]; then
    remote_dir_quoted="$(shell_quote "${REMOTE_DIR}")"
    remote_command=$(
      printf "cd %s && CLUB_CONTENT_SMOKE_ON_VPS=1 COMPOSE_FILE=%s ORGANIZATION_SLUG=%s CLUB_SLUG=%s TEAM_SLUG=%s SUBMITTER_EMAIL=%s ORGANIZATION_ADMIN_EMAIL=%s CLUB_ADMIN_EMAIL=%s TEAM_MANAGER_EMAIL=%s TIMEOUT_SECONDS=%s POLL_SECONDS=%s SMOKE_MARKER=%s bash -s" \
        "${remote_dir_quoted}" \
        "$(shell_quote "${COMPOSE_FILE}")" \
        "$(shell_quote "${ORGANIZATION_SLUG}")" \
        "$(shell_quote "${CLUB_SLUG}")" \
        "$(shell_quote "${TEAM_SLUG}")" \
        "$(shell_quote "${SUBMITTER_EMAIL}")" \
        "$(shell_quote "${ORGANIZATION_ADMIN_EMAIL}")" \
        "$(shell_quote "${CLUB_ADMIN_EMAIL}")" \
        "$(shell_quote "${TEAM_MANAGER_EMAIL}")" \
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

echo "Applying organization routing rule for video -> club admin..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${ORGANIZATION_ADMIN_EMAIL}"'","routingRule":{"contentTypeApprovers":{"video":"club_admin"}}}' \
  "http://localhost:4000/workflow-policies/organizations/${ORGANIZATION_SLUG}" >/dev/null

echo "Applying club routing override for video -> team manager..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","routingRule":{"contentTypeApprovers":{"video":"team_manager"}}}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

policy_json="$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")"
POLICY_JSON="${policy_json}" node <<'NODE'
const assert = require("node:assert/strict");

const policy = JSON.parse(process.env.POLICY_JSON);

assert.equal(
  policy.organizationPolicy?.routingRule?.contentTypeApprovers?.video,
  "club_admin",
  "Organization routing rule should target club_admin"
);
assert.equal(
  policy.clubPolicy?.routingRule?.contentTypeApprovers?.video,
  "team_manager",
  "Club routing override should target team_manager"
);
assert.equal(
  policy.effectivePolicy?.routingRule?.contentTypeApprovers?.video,
  "team_manager",
  "Effective routing rule should prefer the club override"
);
NODE

echo "Creating routing rule smoke submission: ${SMOKE_MARKER}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"video","visibilityTarget":"internal","rawText":"'"${SMOKE_MARKER}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

submission_id=""
approval_request_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
      s.status,
      COALESCE(ar.id::text, ''),
      COALESCE(ar.approver_role::text, ''),
      COALESCE(requested_event.payload->>'originallyRequestedRole', ''),
      COALESCE(s.routing_decision->>'approverRole', ''),
      COALESCE(s.routing_decision->>'policySource', ''),
      COALESCE(s.routing_decision->>'routingSource', ''),
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
    LEFT JOIN LATERAL (
      SELECT payload
      FROM submission_events
      WHERE submission_id = s.id AND event_name = 'submission.approval.requested'
      ORDER BY created_at DESC
      LIMIT 1
    ) requested_event ON TRUE
    WHERE s.raw_text = '${SMOKE_MARKER}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r submission_id status approval_request_id approver_role originally_requested_role routing_approver_role policy_source routing_source processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed before routing for submission ${submission_id}: ${processing_error}" >&2
      exit 1
    fi

    if [[ -n "${approval_request_id}" && "${originally_requested_role}" == "team_manager" && "${routing_approver_role}" == "team_manager" && "${policy_source}" == "routing_rule_content_type" ]]; then
      echo "Routing rule smoke passed."
      echo "submission_id=${submission_id}"
      echo "approval_request_id=${approval_request_id}"
      echo "status=${status}"
      echo "approver_role=${approver_role}"
      echo "originally_requested_role=${originally_requested_role}"
      echo "routing_approver_role=${routing_approver_role}"
      echo "policy_source=${policy_source}"
      echo "routing_source=${routing_source}"
      echo "organization_video_role=club_admin"
      echo "club_video_role=team_manager"
      echo "effective_video_role=team_manager"

      curl -fsS \
        -H "content-type: application/json" \
        -d '{"action":"request_changes","actedByEmail":"'"${REVIEWER_EMAIL:-comms@demo-club.local}"'","notes":"Routing rule smoke cleanup."}' \
        "http://localhost:4000/approval-requests/${approval_request_id}/actions" >/dev/null
      echo "cleanup_action=request_changes"
      exit 0
    fi

    echo "Waiting for routing override. status=${status:-pending} approver_role=${approver_role:-pending} requested_role=${originally_requested_role:-pending} policy_source=${policy_source:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

echo "Timed out waiting for content-type routing on ${SMOKE_MARKER}." >&2
exit 1
