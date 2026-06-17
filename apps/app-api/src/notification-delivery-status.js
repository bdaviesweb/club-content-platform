import {
  describeEmailDeliveryConfig,
  describePushDeliveryConfig
} from "../../../packages/shared/src/index.js";

export function buildNotificationDeliveryStatus({
  resendApiKey = "",
  notificationFromEmail = "",
  supportEmail = "support@example.com",
  resendWebhookEndpointPath = "/webhooks/resend",
  resendWebhookSecret = "",
  resendWebhookEvents = [],
  pushNotificationsEnabled = false,
  pushProvider = "expo",
  pushProjectId = ""
} = {}) {
  const emailConfig = describeEmailDeliveryConfig({
    resendApiKey,
    fromEmail: notificationFromEmail,
    supportEmail
  });
  const pushConfig = describePushDeliveryConfig({
    enabled: pushNotificationsEnabled,
    provider: pushProvider,
    projectId: pushProjectId
  });

  return {
    email: {
      provider: emailConfig.provider,
      enabled: emailConfig.enabled,
      mode: emailConfig.mode,
      reason: emailConfig.reason,
      fromEmailConfigured: emailConfig.fromEmailConfigured,
      supportEmail: emailConfig.supportEmail,
      webhook: {
        endpointPath: resendWebhookEndpointPath,
        secretConfigured: Boolean(resendWebhookSecret),
        subscribedEvents: resendWebhookEvents
      }
    },
    push: {
      provider: pushConfig.provider,
      enabled: pushConfig.enabled,
      mode: pushConfig.mode,
      reason: pushConfig.reason,
      projectIdConfigured: pushConfig.projectIdConfigured,
      projectId: pushConfig.projectId,
      registrationEndpoint: "/push-tokens"
    }
  };
}
