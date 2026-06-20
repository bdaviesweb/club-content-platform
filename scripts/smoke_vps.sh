#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
CLUB_CONTENT_SMOKE_ON_VPS="${CLUB_CONTENT_SMOKE_ON_VPS:-0}"

if [[ "${CLUB_CONTENT_SMOKE_ON_VPS}" != "1" ]]; then
  exec ssh "${REMOTE_HOST}" \
    "cd '${REMOTE_DIR}' && CLUB_CONTENT_SMOKE_ON_VPS=1 bash -s" < "$0"
fi

read_env_value() {
  local file_path="$1"
  local key="$2"

  node -e '
const fs = require("node:fs");
const [filePath, key] = process.argv.slice(1);
const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
for (const line of lines) {
  if (!line || /^\s*#/.test(line)) continue;
  const match = line.match(/^\s*([^=]+?)\s*=\s*(.*)\s*$/);
  if (!match) continue;
  if (match[1] !== key) continue;
  let value = match[2];
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("\x27") && value.endsWith("\x27"))
  ) {
    value = value.slice(1, -1);
  }
  process.stdout.write(value);
  process.exit(0);
}
' "$file_path" "$key"
}

if [[ -f .env.vps ]]; then
  ADMIN_BASIC_AUTH_USER="$(read_env_value .env.vps ADMIN_BASIC_AUTH_USER || true)"
  ADMIN_BASIC_AUTH_PASSWORD="$(read_env_value .env.vps ADMIN_BASIC_AUTH_PASSWORD || true)"
fi

admin_curl_args=()
if [[ -n "${ADMIN_BASIC_AUTH_USER:-}" && -n "${ADMIN_BASIC_AUTH_PASSWORD:-}" ]]; then
  admin_curl_args=(-u "${ADMIN_BASIC_AUTH_USER}:${ADMIN_BASIC_AUTH_PASSWORD}")
fi

admin_curl() {
  local url="$1"

  if [[ ${#admin_curl_args[@]} -gt 0 ]]; then
    curl -fsS "${admin_curl_args[@]}" "$url"
    return
  fi

  curl -fsS "$url"
}

api_health="$(curl -fsS http://localhost:4000/health)"
app_readiness="$(curl -fsS http://localhost:4000/app/readiness)"
admin_health="$(curl -fsS http://localhost:3002/health)"
approval_queue="$(curl -fsS http://localhost:4000/approvals/queue)"
workflow_events="$(curl -fsS http://localhost:4000/workflow-events)"
notification_delivery_status="$(curl -fsS http://localhost:4000/notification-delivery/status)"
demo_club_slug="$(APP_READINESS="${app_readiness}" node -e 'const readiness = JSON.parse(process.env.APP_READINESS); process.stdout.write(readiness.demo?.clubSlug || "");')"

if [[ -z "${demo_club_slug}" ]]; then
  echo "Could not determine demo club slug from app readiness." >&2
  exit 1
fi

club_workflow_policy="$(curl -fsS "http://localhost:4000/workflow-policies/clubs/${demo_club_slug}")"
organization_slug="$(CLUB_WORKFLOW_POLICY="${club_workflow_policy}" node -e 'const policy = JSON.parse(process.env.CLUB_WORKFLOW_POLICY); process.stdout.write(policy.organization?.slug || "");')"

if [[ -z "${organization_slug}" ]]; then
  echo "Club workflow policy did not expose an organization slug." >&2
  exit 1
fi

organization_workflow_policy="$(curl -fsS "http://localhost:4000/workflow-policies/organizations/${organization_slug}")"
organization_directory="$(curl -fsS "http://localhost:4000/organizations/${organization_slug}")"
workflow_settings_html="$(admin_curl "http://localhost:3002/workflow-settings?clubSlug=${demo_club_slug}")"

API_HEALTH="${api_health}" \
APP_READINESS="${app_readiness}" \
ADMIN_HEALTH="${admin_health}" \
APPROVAL_QUEUE="${approval_queue}" \
WORKFLOW_EVENTS="${workflow_events}" \
NOTIFICATION_DELIVERY_STATUS="${notification_delivery_status}" \
CLUB_WORKFLOW_POLICY="${club_workflow_policy}" \
ORGANIZATION_WORKFLOW_POLICY="${organization_workflow_policy}" \
ORGANIZATION_DIRECTORY="${organization_directory}" \
WORKFLOW_SETTINGS_HTML="${workflow_settings_html}" \
node <<'NODE'
const assert = require('node:assert/strict');

const apiHealth = JSON.parse(process.env.API_HEALTH);
const appReadiness = JSON.parse(process.env.APP_READINESS);
const adminHealth = JSON.parse(process.env.ADMIN_HEALTH);
const approvalQueue = JSON.parse(process.env.APPROVAL_QUEUE);
const workflowEvents = JSON.parse(process.env.WORKFLOW_EVENTS);
const notificationDeliveryStatus = JSON.parse(process.env.NOTIFICATION_DELIVERY_STATUS);
const clubWorkflowPolicy = JSON.parse(process.env.CLUB_WORKFLOW_POLICY);
const organizationWorkflowPolicy = JSON.parse(process.env.ORGANIZATION_WORKFLOW_POLICY);
const organizationDirectory = JSON.parse(process.env.ORGANIZATION_DIRECTORY);
const workflowSettingsHtml = process.env.WORKFLOW_SETTINGS_HTML;

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
assert.equal(clubWorkflowPolicy.scopeType, 'club');
assert.equal(clubWorkflowPolicy.club?.slug, appReadiness.demo.clubSlug);
assert.ok(clubWorkflowPolicy.organization?.slug, 'club workflow policy must expose organization slug');
assert.ok(clubWorkflowPolicy.effectivePolicy, 'club workflow policy must expose effective policy');
assert.equal(organizationWorkflowPolicy.scopeType, 'organization');
assert.equal(organizationWorkflowPolicy.organization?.slug, clubWorkflowPolicy.organization.slug);
assert.equal(organizationDirectory.organization?.slug, clubWorkflowPolicy.organization.slug);
assert.ok(Array.isArray(organizationDirectory.clubs), 'organization directory must expose clubs');
assert.ok(Array.isArray(organizationDirectory.admins), 'organization directory must expose admins');
assert.ok(
  organizationDirectory.clubs.some((club) => club?.slug === appReadiness.demo.clubSlug),
  'organization directory must include the demo club'
);
assert.ok(
  organizationDirectory.admins.some((admin) => admin?.role === 'organization_admin' && admin?.email),
  'organization directory must include at least one organization admin'
);
assert.match(workflowSettingsHtml, /Workflow settings/i);
assert.match(workflowSettingsHtml, /Set routing rules by club or by organization/i);
assert.match(workflowSettingsHtml, new RegExp(appReadiness.demo.clubSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

console.log('api_health=ok');
console.log('app_readiness=ok');
console.log('admin_health=ok');
console.log('workflow_settings=ok');
console.log('organization_directory=ok');
console.log('approval_queue_items=' + approvalQueue.items.length);
console.log('workflow_failed_items=' + workflowEvents.items.length);
console.log('notification_email_mode=' + notificationDeliveryStatus.email.mode);
console.log('notification_push_mode=' + notificationDeliveryStatus.push.mode);
console.log('workflow_policy_org=' + clubWorkflowPolicy.organization.slug);
console.log('organization_club_count=' + organizationDirectory.clubs.length);
console.log('organization_admin_count=' + organizationDirectory.admins.length);
if (approvalQueue.items[0]) {
  console.log('approval_queue_first_id=' + approvalQueue.items[0].id);
}
if (workflowEvents.items[0]) {
  console.log('workflow_failed_first_id=' + workflowEvents.items[0].id);
}
NODE
