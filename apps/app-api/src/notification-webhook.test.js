import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWebhookAction,
  recordNotificationWebhookEvent
} from "./notification-webhook.js";

test("normalizes webhook action names for audit log keys", () => {
  assert.equal(normalizeWebhookAction("email.delivered"), "email_delivered");
  assert.equal(normalizeWebhookAction("Email Bounced!"), "email_bounced");
  assert.equal(normalizeWebhookAction(""), "unknown");
});

test("records unmatched webhook events under notification_webhook", async () => {
  const calls = [];
  const result = await recordNotificationWebhookEvent(
    {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("SELECT entity_id")) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      }
    },
    {
      verified: false,
      event: {
        type: "email.delivered",
        created_at: "2026-06-17T20:00:00Z",
        data: {
          email_id: "email-1",
          to: ["coach@example.test"]
        }
      }
    }
  );

  assert.equal(result.matchedNotificationId, null);
  assert.equal(result.action, "notification.email.webhook.email_delivered");
  assert.equal(result.recipientEmail, "coach@example.test");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params[0], "notification_webhook");
  assert.equal(calls[1].params[1], null);
  const metadata = JSON.parse(calls[1].params[3]);
  assert.equal(metadata.verified, false);
  assert.equal(metadata.emailId, "email-1");
});

test("records matched webhook events on the notification entity", async () => {
  const calls = [];
  const result = await recordNotificationWebhookEvent(
    {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("SELECT entity_id")) {
          return { rowCount: 1, rows: [{ notificationId: "notification-1" }] };
        }
        return { rowCount: 1, rows: [] };
      }
    },
    {
      verified: true,
      event: {
        type: "email.delivered",
        created_at: "2026-06-17T20:01:00Z",
        data: {
          email_id: "provider-email-1",
          to: "coach@example.test"
        }
      }
    }
  );

  assert.equal(result.matchedNotificationId, "notification-1");
  assert.equal(result.verified, true);
  assert.equal(calls[1].params[0], "notification");
  assert.equal(calls[1].params[1], "notification-1");
  const metadata = JSON.parse(calls[1].params[3]);
  assert.equal(metadata.matchedNotificationId, "notification-1");
  assert.equal(metadata.recipientEmail, "coach@example.test");
});
