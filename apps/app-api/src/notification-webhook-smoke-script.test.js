import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/notification_webhook_smoke_vps.sh");

function createFakeSshBin({
  statusJson,
  matchRow,
  responseJson,
  matchedAuditRow,
  unmatchedAuditRow,
  notificationsJson
}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-fake-ssh-"));
  const sshPath = path.join(tempDir, "ssh");
  const statePath = path.join(tempDir, "state.json");

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        statusJson,
        matchRow,
        responseJson,
        matchedAuditRow,
        unmatchedAuditRow,
        notificationsJson
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    sshPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_SSH_STATE, "utf8"));
const command = process.argv.slice(2).join(" ");

function write(value) {
  process.stdout.write(String(value || ""));
}

if (command.includes("notification-delivery/status")) {
  write(state.statusJson);
  process.exit(0);
}

if (command.includes("FROM notifications n") && command.includes("providerId")) {
  write(state.matchRow);
  process.exit(0);
}

if (command.includes("http://localhost:4000/webhooks/resend")) {
  write(state.responseJson);
  process.exit(0);
}

if (command.includes("WHERE entity_type = 'notification'")) {
  write(state.matchedAuditRow);
  process.exit(0);
}

if (command.includes("WHERE action = 'notification.email.webhook.email_delivered'")) {
  write(state.unmatchedAuditRow);
  process.exit(0);
}

if (command.includes("http://localhost:4000/notifications?userEmail=")) {
  write(state.notificationsJson);
  process.exit(0);
}

console.error("Unexpected fake ssh command:\\n" + command);
process.exit(1);
`
  );
  fs.chmodSync(sshPath, 0o755);

  return {
    tempDir,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function runWebhookSmoke(options) {
  const fakeSsh = createFakeSshBin(options);

  try {
    return execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeSsh.tempDir}:${process.env.PATH}`,
        FAKE_SSH_STATE: path.join(fakeSsh.tempDir, "state.json"),
        REMOTE_HOST: "fake-host",
        REMOTE_DIR: "/fake/remote",
        WEBHOOK_TYPE: "email.delivered",
        RECIPIENT_EMAIL: "coach@example.test",
        EMAIL_ID: "webhook-smoke-fixed"
      }
    });
  } finally {
    fakeSsh.cleanup();
  }
}

test("notification webhook smoke stays unmatched when email delivery is disabled", () => {
  const output = runWebhookSmoke({
    statusJson: JSON.stringify({
      email: { enabled: false, provider: "log-only", mode: "log-only" },
      push: { enabled: false, provider: "expo", mode: "disabled" }
    }),
    matchRow: "notification-older|provider-email-older|coach@example.test|submission_published",
    responseJson: JSON.stringify({
      received: true,
      verified: false,
      webhookType: "email.delivered",
      matchedNotificationId: null,
      emailId: "webhook-smoke-fixed"
    }),
    matchedAuditRow: "",
    unmatchedAuditRow:
      "notification_webhook||notification.email.webhook.email_delivered|false|email.delivered|webhook-smoke-fixed|coach@example.test",
    notificationsJson: ""
  });

  assert.match(output, /Notification webhook smoke passed\./);
  assert.match(output, /"mode": "unmatched"/);
  assert.match(output, /"emailEnabled": false/);
  assert.match(output, /"entityType": "notification_webhook"/);
  assert.doesNotMatch(output, /notification-older/);
});

test("notification webhook smoke verifies matched delivery propagation when email delivery is enabled", () => {
  const output = runWebhookSmoke({
    statusJson: JSON.stringify({
      email: { enabled: true, provider: "resend", mode: "resend" },
      push: { enabled: false, provider: "expo", mode: "disabled" }
    }),
    matchRow: "notification-1|provider-email-1|coach@example.test|submission_published",
    responseJson: JSON.stringify({
      received: true,
      verified: false,
      webhookType: "email.delivered",
      matchedNotificationId: "notification-1",
      emailId: "provider-email-1"
    }),
    matchedAuditRow:
      "notification|notification-1|notification.email.webhook.email_delivered|false|email.delivered|provider-email-1|coach@example.test",
    unmatchedAuditRow: "",
    notificationsJson: JSON.stringify({
      items: [
        {
          id: "notification-1",
          type: "submission_published",
          deliveryStatus: "email.delivered",
          deliveryProviderId: "provider-email-1",
          deliveryUpdatedAt: "2026-06-18T12:05:00.000Z"
        }
      ]
    })
  });

  assert.match(output, /Notification webhook smoke passed\./);
  assert.match(output, /"mode": "matched"/);
  assert.match(output, /"emailEnabled": true/);
  assert.match(output, /"deliveryStatus": "email\.delivered"/);
  assert.match(output, /"deliveryProviderId": "provider-email-1"/);
  assert.match(output, /"entityType": "notification"/);
});
