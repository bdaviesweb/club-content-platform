#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
CLUB_CONTENT_SMOKE_ON_VPS="${CLUB_CONTENT_SMOKE_ON_VPS:-0}"

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS}" != "1" ]]; then
  exec ssh "${REMOTE_HOST}" \
    "cd '${REMOTE_DIR}' && CLUB_CONTENT_SMOKE_ON_VPS=1 bash -s" < "$0"
fi

api_health="$(curl -fsS http://localhost:4000/health)"
app_readiness="$(curl -fsS http://localhost:4000/app/readiness)"
admin_health="$(curl -fsS http://localhost:3002/health)"
approval_queue="$(curl -fsS http://localhost:4000/approvals/queue)"
workflow_events="$(curl -fsS http://localhost:4000/workflow-events)"
notification_delivery_status="$(curl -fsS http://localhost:4000/notification-delivery/status)"

API_HEALTH="${api_health}" \
APP_READINESS="${app_readiness}" \
ADMIN_HEALTH="${admin_health}" \
APPROVAL_QUEUE="${approval_queue}" \
WORKFLOW_EVENTS="${workflow_events}" \
NOTIFICATION_DELIVERY_STATUS="${notification_delivery_status}" \
node <<'NODE'
const assert = require('node:assert/strict');

const apiHealth = JSON.parse(process.env.API_HEALTH);
const appReadiness = JSON.parse(process.env.APP_READINESS);
const adminHealth = JSON.parse(process.env.ADMIN_HEALTH);
const approvalQueue = JSON.parse(process.env.APPROVAL_QUEUE);
const workflowEvents = JSON.parse(process.env.WORKFLOW_EVENTS);
const notificationDeliveryStatus = JSON.parse(process.env.NOTIFICATION_DELIVERY_STATUS);

assert.equal(apiHealth.service, 'app-api');
assert.equal(apiHealth.status, 'ok');
assert.equal(appReadiness.productName, 'Club Content');
assert.ok(appReadiness.demo?.clubSlug, 'app readiness must expose a demo club slug');
assert.ok(appReadiness.demo?.teamSlug, 'app readiness must expose a demo team slug');
assert.equal(typeof appReadiness.capabilities?.submissions, 'boolean');
assert.equal(typeof appReadiness.capabilities?.review, 'boolean');
assert.ok(Array.isArray(appReadiness.checks), 'app readiness checks must be an array');
assert.equal(adminHealth.service, 'admin-web');
assert.equal(adminHealth.status, 'ok');
assert.ok(Array.isArray(approvalQueue.items), 'approval queue items must be an array');
assert.ok(Array.isArray(workflowEvents.items), 'workflow events items must be an array');
assert.ok(notificationDeliveryStatus.email, 'notification delivery status must include email state');
assert.ok(notificationDeliveryStatus.push, 'notification delivery status must include push state');
assert.equal(typeof notificationDeliveryStatus.email.enabled, 'boolean');
assert.equal(typeof notificationDeliveryStatus.push.enabled, 'boolean');
assert.equal(notificationDeliveryStatus.push.registrationEndpoint, '/push-tokens');

console.log('api_health=ok');
console.log('app_readiness=ok');
console.log('admin_health=ok');
console.log('approval_queue_items=' + approvalQueue.items.length);
console.log('workflow_failed_items=' + workflowEvents.items.length);
console.log('notification_email_mode=' + notificationDeliveryStatus.email.mode);
console.log('notification_push_mode=' + notificationDeliveryStatus.push.mode);
if (approvalQueue.items[0]) {
  console.log('approval_queue_first_id=' + approvalQueue.items[0].id);
}
if (workflowEvents.items[0]) {
  console.log('workflow_failed_first_id=' + workflowEvents.items[0].id);
}
NODE
