import assert from "node:assert/strict";
import test from "node:test";

import {
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
