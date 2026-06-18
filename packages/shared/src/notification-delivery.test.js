import assert from "node:assert/strict";
import test from "node:test";

import {
  createAndDeliverNotification,
  describeEmailDeliveryConfig,
  sendEmailViaResend
} from "./notification-delivery.js";

test("reports log-only email delivery when resend config is missing", () => {
  const result = describeEmailDeliveryConfig({
    resendApiKey: "",
    fromEmail: "",
    supportEmail: "support@davmn.net"
  });

  assert.deepEqual(result, {
    provider: "log-only",
    enabled: false,
    mode: "log-only",
    reason: "missing_resend_api_key",
    fromEmailConfigured: false,
    supportEmail: "support@davmn.net"
  });
});

test("reports resend email delivery when config is complete", () => {
  const result = describeEmailDeliveryConfig({
    resendApiKey: "secret",
    fromEmail: "noreply@example.test",
    supportEmail: "support@example.test"
  });

  assert.deepEqual(result, {
    provider: "resend",
    enabled: true,
    mode: "resend",
    reason: null,
    fromEmailConfigured: true,
    supportEmail: "support@example.test"
  });
});

test("returns log-only resend delivery details when config is incomplete", async () => {
  const result = await sendEmailViaResend({
    toEmail: "coach@example.test",
    subject: "Review started",
    text: "Hello",
    html: "<p>Hello</p>",
    fromEmail: "",
    resendApiKey: ""
  });

  assert.equal(result.delivered, false);
  assert.equal(result.channel, "email");
  assert.equal(result.mode, "log-only");
  assert.equal(result.reason, "missing_resend_config");
});

test("creates in-app notifications while skipping email and push when policy disables both channels", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });

      if (String(sql).includes("INSERT INTO notifications")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "notification-1",
              user_id: params[0],
              type: params[1],
              payload: JSON.parse(params[2]),
              created_at: new Date().toISOString()
            }
          ]
        };
      }

      if (String(sql).includes("SELECT email, full_name")) {
        return {
          rowCount: 1,
          rows: [{ email: "coach@example.test", full_name: "Coach" }]
        };
      }

      if (String(sql).includes("WITH latest_push_state")) {
        throw new Error("push registrations should not be queried when push is policy-disabled");
      }

      return { rowCount: 1, rows: [] };
    }
  };

  const result = await createAndDeliverNotification(client, {
    userId: "user-1",
    type: "submission_published",
    payload: {
      submissionId: "submission-1",
      status: "published",
      destinationType: "internal_feed"
    },
    notificationPolicy: {
      email: false,
      push: false
    }
  });

  assert.equal(result.notification.id, "notification-1");
  assert.equal(result.deliveries.email.mode, "policy-disabled");
  assert.equal(result.deliveries.email.reason, "notification_policy_email_disabled");
  assert.equal(result.deliveries.push.mode, "policy-disabled");
  assert.equal(result.deliveries.push.reason, "notification_policy_push_disabled");

  const emailAudit = calls.find(
    ({ sql, params }) =>
      sql.includes("INSERT INTO audit_logs") &&
      params[2] === "notification.email.skipped"
  );
  const pushAudit = calls.find(
    ({ sql, params }) =>
      sql.includes("INSERT INTO audit_logs") &&
      params[2] === "notification.push.skipped"
  );

  assert.ok(emailAudit, "expected email audit log");
  assert.ok(pushAudit, "expected push audit log");
  assert.equal(
    JSON.parse(emailAudit.params[3]).delivery.reason,
    "notification_policy_email_disabled"
  );
  assert.equal(
    JSON.parse(pushAudit.params[3]).delivery.reason,
    "notification_policy_push_disabled"
  );
});
