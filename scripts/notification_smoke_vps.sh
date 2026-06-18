#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
NOTIFICATION_LIMIT="${NOTIFICATION_LIMIT:-5}"

ssh "${REMOTE_HOST}" /bin/bash -s -- \
  "${REMOTE_DIR}" \
  "${SUBMITTER_EMAIL}" \
  "${NOTIFICATION_LIMIT}" <<'INNER'
set -euo pipefail

REMOTE_DIR="$1"
SUBMITTER_EMAIL="$2"
NOTIFICATION_LIMIT="$3"

cd "${REMOTE_DIR}"

status_json=$(curl -fsS http://localhost:4000/notification-delivery/status)
notifications_json=$(curl -fsS "http://localhost:4000/notifications?userEmail=${SUBMITTER_EMAIL}&limit=${NOTIFICATION_LIMIT}")
audit_rows=$(docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -At -F '|' -c "
  SELECT
    n.id,
    n.type,
    COALESCE(email_log.action, ''),
    COALESCE(email_log.metadata->'delivery'->>'mode', ''),
    COALESCE(email_log.metadata->'delivery'->>'reason', ''),
    COALESCE(push_log.action, ''),
    COALESCE(push_log.metadata->'delivery'->>'mode', ''),
    COALESCE(push_log.metadata->'delivery'->>'reason', ''),
    COALESCE(push_log.metadata->>'tokenCount', '')
  FROM notifications n
  JOIN users u ON u.id = n.user_id
  LEFT JOIN LATERAL (
    SELECT action, metadata
    FROM audit_logs
    WHERE entity_type = 'notification'
      AND entity_id = n.id
      AND action LIKE 'notification.email.%'
    ORDER BY created_at DESC
    LIMIT 1
  ) email_log ON TRUE
  LEFT JOIN LATERAL (
    SELECT action, metadata
    FROM audit_logs
    WHERE entity_type = 'notification'
      AND entity_id = n.id
      AND action LIKE 'notification.push.%'
    ORDER BY created_at DESC
    LIMIT 1
  ) push_log ON TRUE
  WHERE u.email = '${SUBMITTER_EMAIL}'
  ORDER BY n.created_at DESC
  LIMIT ${NOTIFICATION_LIMIT};
")

STATUS_JSON="${status_json}" \
NOTIFICATIONS_JSON="${notifications_json}" \
AUDIT_ROWS="${audit_rows}" \
SUBMITTER_EMAIL="${SUBMITTER_EMAIL}" \
node <<'NODE'
const assert = require("node:assert/strict");

const status = JSON.parse(process.env.STATUS_JSON);
const notifications = JSON.parse(process.env.NOTIFICATIONS_JSON);
const rawAuditRows = process.env.AUDIT_ROWS || "";
const submitterEmail = process.env.SUBMITTER_EMAIL;

assert.ok(status.email, "notification delivery status must include email state");
assert.ok(status.push, "notification delivery status must include push state");
assert.equal(status.push.registrationEndpoint, "/push-tokens");

assert.ok(Array.isArray(notifications.items), "notifications.items must be an array");
if (notifications.items.length === 0) {
  console.error(
    `No notifications found for ${submitterEmail}. Create or update a demo submission first, then rerun notification_smoke_vps.sh.`
  );
  process.exit(1);
}

const allowedEmailActions = new Set([
  "notification.email.delivered",
  "notification.email.skipped",
  "notification.email.failed"
]);
const allowedPushActions = new Set([
  "notification.push.delivered",
  "notification.push.skipped",
  "notification.push.failed"
]);

const auditRows = rawAuditRows
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((row) => {
    const [
      notificationId,
      type,
      emailAction,
      emailMode,
      emailReason,
      pushAction,
      pushMode,
      pushReason,
      tokenCount
    ] = row.split("|");

    return {
      notificationId,
      type,
      emailAction,
      emailMode,
      emailReason,
      pushAction,
      pushMode,
      pushReason,
      tokenCount: tokenCount === "" ? null : Number(tokenCount)
    };
  });

assert.ok(auditRows.length > 0, "expected at least one notification audit row");

const firstNotification = notifications.items[0];
assert.ok(firstNotification.id, "notification items must include an id");
assert.ok(firstNotification.type, "notification items must include a type");

const latestAudit = auditRows.find((row) => row.notificationId === firstNotification.id);
assert.ok(latestAudit, "latest notification should have a matching audit row");
assert.ok(
  allowedEmailActions.has(latestAudit.emailAction),
  `unexpected email audit action: ${latestAudit.emailAction}`
);
assert.ok(
  allowedPushActions.has(latestAudit.pushAction),
  `unexpected push audit action: ${latestAudit.pushAction}`
);
assert.equal(typeof latestAudit.emailMode, "string");
assert.equal(typeof latestAudit.pushMode, "string");
assert.ok(
  latestAudit.tokenCount === null || Number.isFinite(latestAudit.tokenCount),
  "push token count should be numeric when present"
);

console.log("Notification smoke passed.");
console.log(
  JSON.stringify(
    {
      submitterEmail,
      notificationCount: notifications.items.length,
      latestNotification: {
        id: firstNotification.id,
        type: firstNotification.type,
        deliveryStatus: firstNotification.deliveryStatus || null,
        deliveryProviderId: firstNotification.deliveryProviderId || null,
        deliveryUpdatedAt: firstNotification.deliveryUpdatedAt || null
      },
      latestAudit
    },
    null,
    2
  )
);
NODE
INNER
