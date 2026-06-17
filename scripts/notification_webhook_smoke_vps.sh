#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
WEBHOOK_TYPE="${WEBHOOK_TYPE:-email.delivered}"
EMAIL_ID="${EMAIL_ID:-webhook-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"
RECIPIENT_EMAIL="${RECIPIENT_EMAIL:-coach@demo-club.local}"

ssh "${REMOTE_HOST}" /bin/bash <<INNER
set -euo pipefail
cd '${REMOTE_DIR}'

payload='{"type":"${WEBHOOK_TYPE}","created_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","data":{"email_id":"${EMAIL_ID}","to":["${RECIPIENT_EMAIL}"]}}'

response=\$(curl -fsS \
  -H "content-type: application/json" \
  -d "\${payload}" \
  http://localhost:4000/webhooks/resend)

printf '%s\n' "\${response}"
echo ---

docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -At -F '|' -c "
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
    AND metadata->>'emailId' = '${EMAIL_ID}'
  ORDER BY created_at DESC
  LIMIT 1;
" | node -e "
const fs = require('node:fs');
const raw = fs.readFileSync(0, 'utf8').trim();
if (!raw) {
  console.error('Webhook smoke audit row not found.');
  process.exit(1);
}
const [entityType, entityId, action, verified, webhookType, emailId, recipientEmail] = raw.split('|');
if (entityType !== 'notification_webhook') {
  console.error('Unexpected entity_type: ' + entityType);
  process.exit(1);
}
if (action !== 'notification.email.webhook.email_delivered') {
  console.error('Unexpected action: ' + action);
  process.exit(1);
}
if (verified !== 'false') {
  console.error('Unexpected verified flag: ' + verified);
  process.exit(1);
}
if (webhookType !== 'email.delivered') {
  console.error('Unexpected webhook type: ' + webhookType);
  process.exit(1);
}
if (emailId !== '${EMAIL_ID}') {
  console.error('Unexpected email id: ' + emailId);
  process.exit(1);
}
if (recipientEmail !== '${RECIPIENT_EMAIL}') {
  console.error('Unexpected recipient email: ' + recipientEmail);
  process.exit(1);
}
console.log('Notification webhook smoke passed.');
console.log(JSON.stringify({
  entityType,
  entityId: entityId || null,
  action,
  verified: verified === 'true',
  webhookType,
  emailId,
  recipientEmail
}, null, 2));
"
INNER
