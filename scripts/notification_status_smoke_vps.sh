#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
SSH_OPTS="${SSH_OPTS:-}"
EXPECTED_EMAIL_PROVIDER="${EXPECTED_EMAIL_PROVIDER:-log-only}"
EXPECTED_EMAIL_ENABLED="${EXPECTED_EMAIL_ENABLED:-false}"
EXPECTED_EMAIL_MODE="${EXPECTED_EMAIL_MODE:-log-only}"
EXPECTED_EMAIL_REASON="${EXPECTED_EMAIL_REASON:-missing_resend_api_key}"
EXPECTED_PUSH_PROVIDER="${EXPECTED_PUSH_PROVIDER:-expo}"
EXPECTED_PUSH_ENABLED="${EXPECTED_PUSH_ENABLED:-false}"
EXPECTED_PUSH_MODE="${EXPECTED_PUSH_MODE:-disabled}"
EXPECTED_PUSH_REASON="${EXPECTED_PUSH_REASON:-push_disabled}"

status_json="$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "curl -fsS http://localhost:4000/notification-delivery/status")"

STATUS_JSON="${status_json}" \
EXPECTED_EMAIL_PROVIDER="${EXPECTED_EMAIL_PROVIDER}" \
EXPECTED_EMAIL_ENABLED="${EXPECTED_EMAIL_ENABLED}" \
EXPECTED_EMAIL_MODE="${EXPECTED_EMAIL_MODE}" \
EXPECTED_EMAIL_REASON="${EXPECTED_EMAIL_REASON}" \
EXPECTED_PUSH_PROVIDER="${EXPECTED_PUSH_PROVIDER}" \
EXPECTED_PUSH_ENABLED="${EXPECTED_PUSH_ENABLED}" \
EXPECTED_PUSH_MODE="${EXPECTED_PUSH_MODE}" \
EXPECTED_PUSH_REASON="${EXPECTED_PUSH_REASON}" \
node <<'NODE'
const assert = require("node:assert/strict");

const status = JSON.parse(process.env.STATUS_JSON);

const expected = {
  email: {
    provider: process.env.EXPECTED_EMAIL_PROVIDER,
    enabled: process.env.EXPECTED_EMAIL_ENABLED === "true",
    mode: process.env.EXPECTED_EMAIL_MODE,
    reason: process.env.EXPECTED_EMAIL_REASON
  },
  push: {
    provider: process.env.EXPECTED_PUSH_PROVIDER,
    enabled: process.env.EXPECTED_PUSH_ENABLED === "true",
    mode: process.env.EXPECTED_PUSH_MODE,
    reason: process.env.EXPECTED_PUSH_REASON
  }
};

assert.equal(status.email?.provider, expected.email.provider, "Unexpected email provider");
assert.equal(status.email?.enabled, expected.email.enabled, "Unexpected email enabled state");
assert.equal(status.email?.mode, expected.email.mode, "Unexpected email mode");
assert.equal(status.email?.reason, expected.email.reason, "Unexpected email reason");
assert.equal(status.push?.provider, expected.push.provider, "Unexpected push provider");
assert.equal(status.push?.enabled, expected.push.enabled, "Unexpected push enabled state");
assert.equal(status.push?.mode, expected.push.mode, "Unexpected push mode");
assert.equal(status.push?.reason, expected.push.reason, "Unexpected push reason");

console.log("Notification status smoke passed.");
console.log(
  JSON.stringify(
    {
      email: {
        provider: status.email.provider,
        enabled: status.email.enabled,
        mode: status.email.mode,
        reason: status.email.reason
      },
      push: {
        provider: status.push.provider,
        enabled: status.push.enabled,
        mode: status.push.mode,
        reason: status.push.reason
      }
    },
    null,
    2
  )
);
NODE
