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
TEAM_MANAGER_REVIEWER_EMAIL="${TEAM_MANAGER_REVIEWER_EMAIL:-${REVIEWER_EMAIL}}"
SCENARIO_REVIEWER_EMAIL="${SCENARIO_REVIEWER_EMAIL:-${TEAM_MANAGER_REVIEWER_EMAIL}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-240}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-event-notification-rule-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

shell_quote() {
  printf "%q" "$1"
}

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS:-0}" != "1" ]]; then
  current_dir="$(pwd -P)"

  if [[ "${current_dir}" != "${REMOTE_DIR}" || ! -f "${COMPOSE_FILE}" ]]; then
    remote_dir_quoted="$(shell_quote "${REMOTE_DIR}")"
    remote_command=$(
      printf "cd %s && CLUB_CONTENT_SMOKE_ON_VPS=1 COMPOSE_FILE=%s ORGANIZATION_SLUG=%s CLUB_SLUG=%s TEAM_SLUG=%s SUBMITTER_EMAIL=%s ORGANIZATION_ADMIN_EMAIL=%s CLUB_ADMIN_EMAIL=%s REVIEWER_EMAIL=%s TEAM_MANAGER_REVIEWER_EMAIL=%s SCENARIO_REVIEWER_EMAIL=%s TIMEOUT_SECONDS=%s POLL_SECONDS=%s SMOKE_MARKER=%s bash -s" \
        "${remote_dir_quoted}" \
        "$(shell_quote "${COMPOSE_FILE}")" \
        "$(shell_quote "${ORGANIZATION_SLUG}")" \
        "$(shell_quote "${CLUB_SLUG}")" \
        "$(shell_quote "${TEAM_SLUG}")" \
        "$(shell_quote "${SUBMITTER_EMAIL}")" \
        "$(shell_quote "${ORGANIZATION_ADMIN_EMAIL}")" \
        "$(shell_quote "${CLUB_ADMIN_EMAIL}")" \
        "$(shell_quote "${REVIEWER_EMAIL}")" \
        "$(shell_quote "${TEAM_MANAGER_REVIEWER_EMAIL}")" \
        "$(shell_quote "${SCENARIO_REVIEWER_EMAIL}")" \
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

assert_org_default_notification_policy() {
  local policy_json="$1"
  local published_notification_count="$2"

  POLICY_JSON="${policy_json}" \
  PUBLISHED_NOTIFICATION_COUNT="${published_notification_count}" \
  node <<'NODE'
const assert = require("node:assert/strict");

const policy = JSON.parse(process.env.POLICY_JSON);
const publishedNotificationCount = Number(process.env.PUBLISHED_NOTIFICATION_COUNT || "0");

assert.equal(
  policy.effectivePolicy?.notificationRule?.eventChannels?.submission_review_started?.email,
  false,
  "Effective notification rule should disable review-started email"
);
assert.equal(
  policy.effectivePolicy?.notificationRule?.eventChannels?.submission_review_started?.push,
  false,
  "Effective notification rule should disable review-started push"
);
assert.equal(
  publishedNotificationCount,
  0,
  "Review-started smoke should not publish before cleanup"
);
NODE
}

assert_club_override_notification_policy() {
  local policy_json="$1"
  local email_reason="$2"
  local push_reason="$3"

  POLICY_JSON="${policy_json}" \
  EMAIL_REASON="${email_reason}" \
  PUSH_REASON="${push_reason}" \
  node <<'NODE'
const assert = require("node:assert/strict");

const policy = JSON.parse(process.env.POLICY_JSON);
const emailReason = process.env.EMAIL_REASON || "";
const pushReason = process.env.PUSH_REASON || "";

assert.equal(
  policy.clubPolicy?.notificationRule?.email,
  true,
  "Club notification override should enable email"
);
assert.equal(
  policy.clubPolicy?.notificationRule?.push,
  true,
  "Club notification override should enable push"
);
assert.equal(
  policy.effectivePolicy?.notificationRule?.email,
  true,
  "Effective notification rule should enable email"
);
assert.equal(
  policy.effectivePolicy?.notificationRule?.push,
  true,
  "Effective notification rule should enable push"
);
assert.equal(
  policy.effectivePolicy?.notificationRule?.eventChannels?.submission_review_started,
  undefined,
  "Club override should replace the organization event-specific review-started rule"
);
assert.notEqual(
  emailReason,
  "notification_policy_email_disabled",
  "Club override should prevent top-level email policy disables"
);
assert.notEqual(
  emailReason,
  "notification_policy_email_event_disabled",
  "Club override should prevent organization event-level email disables"
);
assert.notEqual(
  pushReason,
  "notification_policy_push_disabled",
  "Club override should prevent top-level push policy disables"
);
assert.notEqual(
  pushReason,
  "notification_policy_push_event_disabled",
  "Club override should prevent organization event-level push disables"
);
NODE
}

restore_notification_baseline() {
  echo "Restoring baseline notification policy..."
  curl -fsS \
    -H "content-type: application/json" \
    -d '{"actorEmail":"'"${ORGANIZATION_ADMIN_EMAIL}"'","notificationRule":{"email":true,"push":true}}' \
    "http://localhost:4000/workflow-policies/organizations/${ORGANIZATION_SLUG}" >/dev/null

  curl -fsS \
    -H "content-type: application/json" \
    -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","notificationRule":{"email":false,"push":false}}' \
    "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null
}

echo "Checking API health..."
curl -fsS http://localhost:4000/health
echo

echo "Applying organization event notification rule for smoke..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${ORGANIZATION_ADMIN_EMAIL}"'","notificationRule":{"email":true,"push":true,"eventChannels":{"submission_review_started":{"email":false,"push":false}}}}' \
  "http://localhost:4000/workflow-policies/organizations/${ORGANIZATION_SLUG}" >/dev/null

echo "Clearing club notification override so the organization rule is authoritative..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","notificationRule":null}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

echo "Creating event notification rule smoke submission: ${SMOKE_MARKER}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"video","visibilityTarget":"internal","rawText":"'"${SMOKE_MARKER}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

submission_id=""
approval_request_id=""
notification_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
      COALESCE(ar.id::text, ''),
      COALESCE(n.id::text, ''),
      COALESCE(n.type, ''),
      COALESCE(email_log.metadata->'delivery'->>'reason', ''),
      COALESCE(push_log.metadata->'delivery'->>'reason', ''),
      COALESCE(s.status::text, ''),
      COALESCE(se.processing_error, '')
    FROM submissions s
    LEFT JOIN LATERAL (
      SELECT id
      FROM approval_requests
      WHERE submission_id = s.id
      ORDER BY created_at ASC
      LIMIT 1
    ) ar ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, type
      FROM notifications
      WHERE user_id = s.submitted_by_user_id
        AND payload->>'submissionId' = s.id::text
        AND type = 'submission_review_started'
      ORDER BY created_at DESC
      LIMIT 1
    ) n ON TRUE
    LEFT JOIN LATERAL (
      SELECT metadata
      FROM audit_logs
      WHERE entity_type = 'notification'
        AND entity_id = n.id
        AND action LIKE 'notification.email.%'
      ORDER BY created_at DESC
      LIMIT 1
    ) email_log ON TRUE
    LEFT JOIN LATERAL (
      SELECT metadata
      FROM audit_logs
      WHERE entity_type = 'notification'
        AND entity_id = n.id
        AND action LIKE 'notification.push.%'
      ORDER BY created_at DESC
      LIMIT 1
    ) push_log ON TRUE
    LEFT JOIN LATERAL (
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id
        AND event_name = 'submission.created'
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.raw_text = '${SMOKE_MARKER}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r submission_id approval_request_id notification_id notification_type email_reason push_reason status processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed before notification policy smoke completed for submission ${submission_id}: ${processing_error}" >&2
      restore_notification_baseline
      exit 1
    fi

    if [[ -n "${approval_request_id}" && -n "${notification_id}" && "${notification_type}" == "submission_review_started" && "${email_reason}" == "notification_policy_email_event_disabled" && "${push_reason}" == "notification_policy_push_event_disabled" ]]; then
      published_notification_count="$(query_one "
        SELECT COUNT(*)
        FROM notifications
        WHERE user_id = (
          SELECT submitted_by_user_id
          FROM submissions
          WHERE id = '${submission_id}'
        )
          AND payload->>'submissionId' = '${submission_id}'
          AND type = 'submission_published';
      ")"

      assert_org_default_notification_policy \
        "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")" \
        "${published_notification_count}"

      curl -fsS \
        -H "content-type: application/json" \
        -d '{"action":"request_changes","actedByEmail":"'"${SCENARIO_REVIEWER_EMAIL}"'","notes":"Event notification rule smoke cleanup."}' \
        "http://localhost:4000/approval-requests/${approval_request_id}/actions" >/dev/null

      restore_notification_baseline

      echo "Event notification rule smoke passed."
      echo "submission_id=${submission_id}"
      echo "approval_request_id=${approval_request_id}"
      echo "notification_id=${notification_id}"
      echo "status=${status}"
      echo "email_reason=${email_reason}"
      echo "push_reason=${push_reason}"
      echo "phase=organization_default"
      break
    fi

    echo "Waiting for event-specific notification policy. status=${status:-pending} notification_type=${notification_type:-pending} email_reason=${email_reason:-pending} push_reason=${push_reason:-pending}"
  else
    echo "Waiting for smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

if [[ -z "${approval_request_id}" || -z "${notification_id}" ]]; then
  restore_notification_baseline
  echo "Timed out waiting for event-specific notification policy on ${SMOKE_MARKER}." >&2
  exit 1
fi

club_override_marker="${SMOKE_MARKER}-club-override"

echo "Applying club notification override to replace organization event-channel rules..."
curl -fsS \
  -H "content-type: application/json" \
  -d '{"actorEmail":"'"${CLUB_ADMIN_EMAIL}"'","notificationRule":{"email":true,"push":true}}' \
  "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}" >/dev/null

echo "Creating club override notification smoke submission: ${club_override_marker}"
curl -fsS \
  -H "content-type: application/json" \
  -d '{"clubSlug":"'"${CLUB_SLUG}"'","teamSlug":"'"${TEAM_SLUG}"'","submitterEmail":"'"${SUBMITTER_EMAIL}"'","contentType":"video","visibilityTarget":"internal","rawText":"'"${club_override_marker}"'","media":[]}' \
  http://localhost:4000/submissions >/dev/null

override_submission_id=""
override_approval_request_id=""
override_notification_id=""
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  row="$(query_one "
    SELECT
      s.id,
      COALESCE(ar.id::text, ''),
      COALESCE(n.id::text, ''),
      COALESCE(n.type, ''),
      COALESCE(email_log.metadata->'delivery'->>'reason', ''),
      COALESCE(push_log.metadata->'delivery'->>'reason', ''),
      COALESCE(s.status::text, ''),
      COALESCE(se.processing_error, '')
    FROM submissions s
    LEFT JOIN LATERAL (
      SELECT id
      FROM approval_requests
      WHERE submission_id = s.id
      ORDER BY created_at ASC
      LIMIT 1
    ) ar ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, type
      FROM notifications
      WHERE user_id = s.submitted_by_user_id
        AND payload->>'submissionId' = s.id::text
        AND type = 'submission_review_started'
      ORDER BY created_at DESC
      LIMIT 1
    ) n ON TRUE
    LEFT JOIN LATERAL (
      SELECT metadata
      FROM audit_logs
      WHERE entity_type = 'notification'
        AND entity_id = n.id
        AND action LIKE 'notification.email.%'
      ORDER BY created_at DESC
      LIMIT 1
    ) email_log ON TRUE
    LEFT JOIN LATERAL (
      SELECT metadata
      FROM audit_logs
      WHERE entity_type = 'notification'
        AND entity_id = n.id
        AND action LIKE 'notification.push.%'
      ORDER BY created_at DESC
      LIMIT 1
    ) push_log ON TRUE
    LEFT JOIN LATERAL (
      SELECT processing_error
      FROM submission_events
      WHERE submission_id = s.id
        AND event_name = 'submission.created'
      ORDER BY created_at DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.raw_text = '${club_override_marker}'
    ORDER BY s.created_at DESC
    LIMIT 1;
  ")"

  if [[ -n "${row}" ]]; then
    IFS='|' read -r override_submission_id override_approval_request_id override_notification_id notification_type email_reason push_reason status processing_error <<< "${row}"

    if [[ -n "${processing_error}" ]]; then
      echo "Worker failed before club override notification smoke completed for submission ${override_submission_id}: ${processing_error}" >&2
      restore_notification_baseline
      exit 1
    fi

    if [[ -n "${override_approval_request_id}" && -n "${override_notification_id}" && "${notification_type}" == "submission_review_started" ]]; then
      assert_club_override_notification_policy \
        "$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${CLUB_SLUG}")" \
        "${email_reason}" \
        "${push_reason}"

      curl -fsS \
        -H "content-type: application/json" \
        -d '{"action":"request_changes","actedByEmail":"'"${SCENARIO_REVIEWER_EMAIL}"'","notes":"Club override notification smoke cleanup."}' \
        "http://localhost:4000/approval-requests/${override_approval_request_id}/actions" >/dev/null

      restore_notification_baseline

      echo "Club override notification smoke passed."
      echo "override_submission_id=${override_submission_id}"
      echo "override_approval_request_id=${override_approval_request_id}"
      echo "override_notification_id=${override_notification_id}"
      echo "override_status=${status}"
      echo "override_email_reason=${email_reason}"
      echo "override_push_reason=${push_reason}"
      echo "phase=club_override"
      exit 0
    fi

    echo "Waiting for club override notification policy. status=${status:-pending} notification_type=${notification_type:-pending} email_reason=${email_reason:-pending} push_reason=${push_reason:-pending}"
  else
    echo "Waiting for club override smoke submission to appear..."
  fi

  sleep "${POLL_SECONDS}"
done

restore_notification_baseline
echo "Timed out waiting for club override notification policy on ${club_override_marker}." >&2
exit 1
