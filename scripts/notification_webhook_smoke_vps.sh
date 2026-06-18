#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
WEBHOOK_TYPE="${WEBHOOK_TYPE:-email.delivered}"
EMAIL_ID="${EMAIL_ID:-webhook-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"
RECIPIENT_EMAIL="${RECIPIENT_EMAIL:-coach@demo-club.local}"

status_json="$(
  ssh "${REMOTE_HOST}" \
    "cd '${REMOTE_DIR}' && curl -fsS http://localhost:4000/notification-delivery/status"
)"
email_enabled="$(
  STATUS_JSON="${status_json}" node -e '
const status = JSON.parse(process.env.STATUS_JSON);
process.stdout.write(status.email?.enabled ? "true" : "false");
'
)"

match_row="$(
  ssh "${REMOTE_HOST}" \
    "cd '${REMOTE_DIR}' && docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -At -F '|' -c \"
      SELECT
        n.id,
        COALESCE(email_log.metadata->'delivery'->>'providerId', ''),
        COALESCE(email_log.metadata->>'recipientEmail', ''),
        n.type
      FROM notifications n
      JOIN users u ON u.id = n.user_id
      LEFT JOIN LATERAL (
        SELECT metadata
        FROM audit_logs
        WHERE entity_type = 'notification'
          AND entity_id = n.id
          AND action = 'notification.email.delivered'
        ORDER BY created_at DESC
        LIMIT 1
      ) AS email_log ON TRUE
      WHERE u.email = '${RECIPIENT_EMAIL}'
        AND COALESCE(email_log.metadata->'delivery'->>'providerId', '') <> ''
      ORDER BY n.created_at DESC
      LIMIT 1;
    \""
)"

response_json=""
audit_row=""
notifications_json=""

if [[ "${email_enabled}" == "true" && -n "${match_row}" ]]; then
  IFS='|' read -r matched_notification_id matched_email_id matched_recipient_email matched_notification_type <<< "${match_row}"
  email_id="${matched_email_id}"
  recipient_email="${matched_recipient_email:-${RECIPIENT_EMAIL}}"
  match_mode="matched"
else
  matched_notification_id=""
  matched_notification_type=""
  email_id="${EMAIL_ID}"
  recipient_email="${RECIPIENT_EMAIL}"
  match_mode="unmatched"
fi

response_json="$(
  ssh "${REMOTE_HOST}" \
    "cd '${REMOTE_DIR}' && payload='{\"type\":\"${WEBHOOK_TYPE}\",\"created_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"data\":{\"email_id\":\"${email_id}\",\"to\":[\"${recipient_email}\"]}}' && curl -fsS -H 'content-type: application/json' -d \"\${payload}\" http://localhost:4000/webhooks/resend"
)"

if [[ "${match_mode}" == "matched" ]]; then
  audit_row="$(
    ssh "${REMOTE_HOST}" \
      "cd '${REMOTE_DIR}' && docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -At -F '|' -c \"
        SELECT
          entity_type,
          COALESCE(entity_id::text, ''),
          action,
          COALESCE(metadata->>'verified', ''),
          COALESCE(metadata->>'webhookType', ''),
          COALESCE(metadata->>'emailId', ''),
          COALESCE(metadata->>'recipientEmail', '')
        FROM audit_logs
        WHERE entity_type = 'notification'
          AND entity_id = '${matched_notification_id}'
          AND action = 'notification.email.webhook.email_delivered'
        ORDER BY created_at DESC
        LIMIT 1;
      \""
  )"
  notifications_json="$(
    ssh "${REMOTE_HOST}" \
      "cd '${REMOTE_DIR}' && curl -fsS 'http://localhost:4000/notifications?userEmail=${recipient_email}&limit=10'"
  )"
else
  audit_row="$(
    ssh "${REMOTE_HOST}" \
      "cd '${REMOTE_DIR}' && docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -At -F '|' -c \"
        SELECT
          entity_type,
          COALESCE(entity_id::text, ''),
          action,
          COALESCE(metadata->>'verified', ''),
          COALESCE(metadata->>'webhookType', ''),
          COALESCE(metadata->>'emailId', ''),
          COALESCE(metadata->>'recipientEmail', '')
        FROM audit_logs
        WHERE action = 'notification.email.webhook.email_delivered'
          AND metadata->>'emailId' = '${email_id}'
        ORDER BY created_at DESC
        LIMIT 1;
      \""
  )"
fi

node_output="$(
  STATUS_JSON="${status_json}" \
  RESPONSE_JSON="${response_json}" \
  AUDIT_ROW="${audit_row}" \
  MATCH_ROW="${match_row}" \
  NOTIFICATIONS_JSON="${notifications_json}" \
  MATCH_MODE="${match_mode}" \
  RECIPIENT_EMAIL="${recipient_email}" \
  WEBHOOK_TYPE="${WEBHOOK_TYPE}" \
  EMAIL_ID="${email_id}" \
  node <<'NODE'
const assert = require("node:assert/strict");

const status = JSON.parse(process.env.STATUS_JSON);
const response = JSON.parse(process.env.RESPONSE_JSON);
const auditRow = process.env.AUDIT_ROW || "";
const matchRow = process.env.MATCH_ROW || "";
const notificationsJson = process.env.NOTIFICATIONS_JSON || "";
const matchMode = process.env.MATCH_MODE;
const recipientEmail = process.env.RECIPIENT_EMAIL;
const webhookType = process.env.WEBHOOK_TYPE;
const emailId = process.env.EMAIL_ID;

assert.equal(response.received, true, "webhook endpoint did not acknowledge receipt");
assert.equal(response.verified, false, "dev webhook smoke should remain unverified");
assert.equal(response.webhookType, webhookType, "unexpected webhook type");
assert.equal(response.emailId, emailId, "unexpected email id");

if (!auditRow) {
  throw new Error("Webhook smoke audit row not found.");
}

const [
  entityType,
  entityId,
  action,
  verified,
  auditWebhookType,
  auditEmailId,
  auditRecipientEmail
] = auditRow.split("|");

assert.equal(action, "notification.email.webhook.email_delivered");
assert.equal(verified, "false");
assert.equal(auditWebhookType, webhookType);
assert.equal(auditEmailId, emailId);
assert.equal(auditRecipientEmail, recipientEmail);

if (matchMode === "matched") {
  const [notificationId, providerId, matchedRecipientEmail, notificationType] = matchRow.split("|");
  const notifications = JSON.parse(notificationsJson);

  assert.equal(status.email?.enabled, true, "matched webhook smoke requires live email delivery");
  assert.equal(providerId, emailId, "matched provider id mismatch");
  assert.equal(matchedRecipientEmail, recipientEmail, "matched recipient mismatch");
  assert.equal(response.matchedNotificationId, notificationId, "response matched the wrong notification");
  assert.equal(entityType, "notification", "matched webhook should attach to notification");
  assert.equal(entityId, notificationId, "audit row attached to the wrong notification");

  const notification = (notifications.items || []).find((item) => item.id === notificationId);
  assert.ok(notification, "matched notification not returned by /notifications");
  assert.equal(notification.deliveryStatus, webhookType, "notification delivery status mismatch");
  assert.equal(notification.deliveryProviderId, emailId, "notification delivery provider id mismatch");
  assert.ok(notification.deliveryUpdatedAt, "notification delivery timestamp missing");

  console.log("Notification webhook smoke passed.");
  console.log(
    JSON.stringify(
      {
        mode: matchMode,
        emailEnabled: status.email.enabled,
        notification: {
          id: notificationId,
          type: notificationType,
          recipientEmail,
          deliveryStatus: notification.deliveryStatus,
          deliveryProviderId: notification.deliveryProviderId,
          deliveryUpdatedAt: notification.deliveryUpdatedAt
        },
        webhook: {
          entityType,
          entityId,
          action,
          verified: verified === "true",
          webhookType: auditWebhookType,
          emailId: auditEmailId
        }
      },
      null,
      2
    )
  );
} else {
  assert.equal(response.matchedNotificationId, null, "unmatched webhook smoke should not attach to a notification");
  assert.equal(entityType, "notification_webhook", "unmatched webhook should stay detached");
  assert.equal(entityId || null, null, "unmatched webhook should not have a notification id");

  console.log("Notification webhook smoke passed.");
  console.log(
    JSON.stringify(
      {
        mode: matchMode,
        emailEnabled: status.email?.enabled || false,
        recipientEmail,
        webhook: {
          entityType,
          entityId: entityId || null,
          action,
          verified: verified === "true",
          webhookType: auditWebhookType,
          emailId: auditEmailId
        }
      },
      null,
      2
    )
  );
}
NODE
)"

if [[ -z "${node_output//[$' \t\r\n']/}" ]]; then
  echo "Notification webhook smoke produced no output."
  exit 1
fi

printf '%s\n' "${node_output}"
