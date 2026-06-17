import assert from "node:assert/strict";
import test from "node:test";

import { buildNotificationDeliveryStatus } from "./notification-delivery-status.js";

test("builds log-only notification delivery status when dev delivery is inactive", () => {
  const result = buildNotificationDeliveryStatus({
    resendApiKey: "",
    notificationFromEmail: "noreply@davmn.net",
    supportEmail: "support@davmn.net",
    resendWebhookEndpointPath: "/webhooks/resend",
    resendWebhookSecret: "",
    resendWebhookEvents: ["email.sent", "email.delivered"],
    pushNotificationsEnabled: false,
    pushProvider: "expo",
    pushProjectId: ""
  });

  assert.deepEqual(result, {
    email: {
      provider: "log-only",
      enabled: false,
      mode: "log-only",
      reason: "missing_resend_api_key",
      fromEmailConfigured: true,
      supportEmail: "support@davmn.net",
      webhook: {
        endpointPath: "/webhooks/resend",
        secretConfigured: false,
        subscribedEvents: ["email.sent", "email.delivered"]
      }
    },
    push: {
      provider: "expo",
      enabled: false,
      mode: "disabled",
      reason: "push_disabled",
      projectIdConfigured: false,
      projectId: null,
      registrationEndpoint: "/push-tokens"
    }
  });
});

test("builds enabled notification delivery status when providers are configured", () => {
  const result = buildNotificationDeliveryStatus({
    resendApiKey: "secret",
    notificationFromEmail: "noreply@davmn.net",
    supportEmail: "support@davmn.net",
    resendWebhookEndpointPath: "/webhooks/resend",
    resendWebhookSecret: "webhook-secret",
    resendWebhookEvents: ["email.sent"],
    pushNotificationsEnabled: true,
    pushProvider: "expo",
    pushProjectId: "project-1"
  });

  assert.deepEqual(result, {
    email: {
      provider: "resend",
      enabled: true,
      mode: "resend",
      reason: null,
      fromEmailConfigured: true,
      supportEmail: "support@davmn.net",
      webhook: {
        endpointPath: "/webhooks/resend",
        secretConfigured: true,
        subscribedEvents: ["email.sent"]
      }
    },
    push: {
      provider: "expo",
      enabled: true,
      mode: "expo",
      reason: null,
      projectIdConfigured: true,
      projectId: "project-1",
      registrationEndpoint: "/push-tokens"
    }
  });
});
