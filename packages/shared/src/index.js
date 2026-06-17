export const submissionEvents = {
  created: "submission.created",
  mediaUploaded: "submission.media.uploaded",
  mediaProcessed: "submission.media.processed",
  aiModerationCompleted: "submission.ai.moderation.completed",
  aiEnrichmentCompleted: "submission.ai.enrichment.completed",
  routed: "submission.routed",
  approvalRequested: "submission.approval.requested",
  approved: "submission.approved",
  rejected: "submission.rejected",
  revisionRequested: "submission.revision.requested",
  publishRequested: "submission.publish.requested",
  published: "submission.published",
  publishFailed: "submission.publish.failed"
};

export const reviewThresholds = {
  highRisk: 0.75,
  mediumRisk: 0.35
};

export const internalDestinationType = "internal_feed";

export {
  buildNotificationEmail,
  buildNotificationPush,
  createAndDeliverNotification,
  describeEmailDeliveryConfig,
  sendEmailViaResend
} from "./notification-delivery.js";
export { describePushDeliveryConfig, sendPushNotifications } from "./push-delivery.js";
