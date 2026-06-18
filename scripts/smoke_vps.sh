#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"

ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && \
  api_health=\$(curl -fsS http://localhost:4000/health) && \
  admin_health=\$(curl -fsS http://localhost:3002/health) && \
  approval_queue=\$(curl -fsS http://localhost:4000/approvals/queue) && \
  workflow_events=\$(curl -fsS http://localhost:4000/workflow-events) && \
  API_HEALTH=\"\${api_health}\" ADMIN_HEALTH=\"\${admin_health}\" APPROVAL_QUEUE=\"\${approval_queue}\" WORKFLOW_EVENTS=\"\${workflow_events}\" node <<'NODE'
const assert = require('node:assert/strict');

const apiHealth = JSON.parse(process.env.API_HEALTH);
const adminHealth = JSON.parse(process.env.ADMIN_HEALTH);
const approvalQueue = JSON.parse(process.env.APPROVAL_QUEUE);
const workflowEvents = JSON.parse(process.env.WORKFLOW_EVENTS);

assert.equal(apiHealth.service, 'app-api');
assert.equal(apiHealth.status, 'ok');
assert.equal(adminHealth.service, 'admin-web');
assert.equal(adminHealth.status, 'ok');
assert.ok(Array.isArray(approvalQueue.items), 'approval queue items must be an array');
assert.ok(Array.isArray(workflowEvents.items), 'workflow events items must be an array');

console.log('api_health=ok');
console.log('admin_health=ok');
console.log('approval_queue_items=' + approvalQueue.items.length);
console.log('workflow_failed_items=' + workflowEvents.items.length);
if (approvalQueue.items[0]) {
  console.log('approval_queue_first_id=' + approvalQueue.items[0].id);
}
if (workflowEvents.items[0]) {
  console.log('workflow_failed_first_id=' + workflowEvents.items[0].id);
}
NODE"
