import { sendPushNotifications } from "./push-delivery.js";

export function describeEmailDeliveryConfig({
  resendApiKey = "",
  fromEmail = "",
  supportEmail = "support@example.com"
} = {}) {
  const hasApiKey = Boolean(resendApiKey);
  const hasFromEmail = Boolean(fromEmail);
  const enabled = hasApiKey && hasFromEmail;

  return {
    provider: enabled ? "resend" : "log-only",
    enabled,
    mode: enabled ? "resend" : "log-only",
    reason: enabled
      ? null
      : !hasApiKey
        ? "missing_resend_api_key"
        : "missing_from_email",
    fromEmailConfigured: hasFromEmail,
    supportEmail
  };
}

function isExpectedNotificationSkip(delivery) {
  return [
    "log-only",
    "disabled",
    "no-recipients",
    "policy-disabled"
  ].includes(delivery?.mode);
}

function emailAuditAction(delivery) {
  if (delivery?.delivered) {
    return "notification.email.delivered";
  }

  return isExpectedNotificationSkip(delivery)
    ? "notification.email.skipped"
    : "notification.email.failed";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanizeToken(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function titleCaseWords(value) {
  return humanizeToken(value).replaceAll(/\b\w/g, (char) => char.toUpperCase());
}

function buildNotificationMessage(type, payload) {
  switch (type) {
    case "submission_review_started":
      return {
        subject: "Review has started for your submission",
        intro: "Your club submission is now with a reviewer.",
        detail:
          payload.summary ||
          "A reviewer will check the content before anything is published.",
        statusLine: `Status: ${titleCaseWords(payload.status || "needs_human_review")}`,
        statusExplanation: "No action is needed from you right now."
      };
    case "submission_published":
      return {
        subject: "Your submission is published",
        intro: "Your club submission was approved and is now live.",
        detail: `Published to ${humanizeToken(payload.destinationType || "internal feed")}.`,
        statusLine: `Status: ${titleCaseWords(payload.status || "published")}`,
        statusExplanation:
          "People with access to that destination can now see this post."
      };
    case "submission_rejected":
      return {
        subject: "Your submission was not approved",
        intro: "Your club submission was reviewed and will not be published in its current form.",
        detail: payload.notes || "The reviewer decided not to move this submission forward.",
        statusLine: "Status: Rejected",
        statusExplanation:
          "This review is closed. If you still want this content published, start a new submission."
      };
    case "submission_changes_requested":
      return {
        subject: "Changes requested before publishing",
        intro: "Your club submission needs updates before it can be approved.",
        detail: payload.notes || "The reviewer requested revisions or more detail.",
        statusLine: "Status: Changes requested",
        statusExplanation:
          "Review is paused until you update the submission and send it back."
      };
    default:
      return {
        subject: "There is an update on your submission",
        intro: "Your club submission has a new workflow update.",
        detail: payload.notes || "Open the app to review the latest status.",
        statusLine: `Status: ${titleCaseWords(payload.status || "updated")}`,
        statusExplanation: "Open the app to review the latest details."
      };
  }
}

export function buildNotificationPush({
  type,
  payload,
  appName
}) {
  const message = buildNotificationMessage(type, payload);
  return {
    title: `${appName || "Club Content"}: ${message.subject}`,
    body: message.detail,
    data: {
      type,
      submissionId: payload.submissionId || null,
      approvalRequestId: payload.approvalRequestId || null,
      status: payload.status || null,
      reasonCode: payload.reasonCode || null
    }
  };
}

export function buildNotificationEmail({
  type,
  payload,
  recipientName,
  appName,
  supportEmail,
  publicAppUrl
}) {
  const message = buildNotificationMessage(type, payload);
  const safeAppName = appName || "Club Content";
  const safeRecipientName = recipientName || "there";
  const submissionId = payload.submissionId || "unknown";
  const safeSupportEmail = supportEmail || "support@example.com";
  const safeAppUrl = publicAppUrl || "";

  const text = [
    `Hi ${safeRecipientName},`,
    "",
    message.intro,
    message.detail,
    message.statusLine,
    message.statusExplanation,
    `Submission ID: ${submissionId}`,
    safeAppUrl ? `App: ${safeAppUrl}` : null,
    `Support: ${safeSupportEmail}`,
    "",
    `Sent by ${safeAppName}`
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fbff;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d7e4f2;border-radius:20px;padding:24px;">
        <p style="color:#0c6ddf;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-size:12px;margin:0 0 8px;">${escapeHtml(
          safeAppName
        )}</p>
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.1;color:#102238;">${escapeHtml(
          message.subject
        )}</h1>
        <p style="margin:0 0 12px;color:#445364;line-height:1.6;">Hi ${escapeHtml(
          safeRecipientName
        )},</p>
        <p style="margin:0 0 12px;color:#445364;line-height:1.6;">${escapeHtml(
          message.intro
        )}</p>
        <p style="margin:0 0 12px;color:#445364;line-height:1.6;">${escapeHtml(
          message.detail
        )}</p>
        <p style="margin:0 0 8px;color:#102238;font-weight:600;">${escapeHtml(
          message.statusLine
        )}</p>
        <p style="margin:0 0 12px;color:#445364;line-height:1.6;">${escapeHtml(
          message.statusExplanation
        )}</p>
        <p style="margin:0 0 16px;color:#445364;line-height:1.6;">Submission ID: <code>${escapeHtml(
          submissionId
        )}</code></p>
        ${
          safeAppUrl
            ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(
                safeAppUrl
              )}" style="display:inline-block;background:#102238;color:#fff7ef;text-decoration:none;padding:12px 16px;border-radius:12px;">Open ${escapeHtml(
                safeAppName
              )}</a></p>`
            : ""
        }
        <p style="margin:0;color:#667788;line-height:1.6;">Need help? Email <a href="mailto:${escapeHtml(
          safeSupportEmail
        )}">${escapeHtml(safeSupportEmail)}</a>.</p>
      </div>
    </div>
  `;

  return {
    subject: `${safeAppName}: ${message.subject}`,
    text,
    html
  };
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveNotificationChannelPolicy({
  notificationPolicy = {},
  type,
  channel
}) {
  const topLevelEnabled = notificationPolicy?.[channel] !== false;
  const eventPolicy = isObjectRecord(notificationPolicy?.eventChannels)
    ? notificationPolicy.eventChannels[type]
    : null;
  const eventEnabled =
    isObjectRecord(eventPolicy) && Object.hasOwn(eventPolicy, channel)
      ? eventPolicy[channel] !== false
      : true;

  if (!topLevelEnabled) {
    return {
      enabled: false,
      reason: `notification_policy_${channel}_disabled`
    };
  }

  if (!eventEnabled) {
    return {
      enabled: false,
      reason: `notification_policy_${channel}_event_disabled`
    };
  }

  return {
    enabled: true,
    reason: null
  };
}

export async function sendEmailViaResend({
  toEmail,
  subject,
  text,
  html,
  fromEmail,
  resendApiKey
}) {
  if (!resendApiKey || !fromEmail) {
    return {
      delivered: false,
      channel: "email",
      mode: "log-only",
      reason: "missing_resend_config"
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject,
      text,
      html
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      delivered: false,
      channel: "email",
      mode: "resend",
      reason: payload.message || `resend_${response.status}`,
      providerResponse: payload
    };
  }

  return {
    delivered: true,
    channel: "email",
    mode: "resend",
    providerId: payload.id || null
  };
}

export async function createAndDeliverNotification(client, {
  userId,
  type,
  payload,
  actorUserId = null,
  notificationPolicy = {}
}) {
  const insertedNotification = await client.query(
    `
    INSERT INTO notifications (user_id, type, payload)
    VALUES ($1, $2, $3::jsonb)
    RETURNING id, user_id, type, payload, created_at
    `,
    [userId, type, JSON.stringify(payload)]
  );

  const notification = insertedNotification.rows[0];
  const userResult = await client.query(
    `
    SELECT email, full_name
    FROM users
    WHERE id = $1
    `,
    [userId]
  );

  if (!userResult.rowCount) {
    throw new Error(`Notification user not found: ${userId}`);
  }

  const user = userResult.rows[0];
  const emailContent = buildNotificationEmail({
    type,
    payload,
    recipientName: user.full_name,
    appName: process.env.PUBLIC_PRODUCT_NAME || "Club Content",
    supportEmail: process.env.SUPPORT_EMAIL || "support@davmn.net",
    publicAppUrl: process.env.PUBLIC_APP_URL || process.env.EXPO_PUBLIC_API_BASE_URL || ""
  });
  const appName = process.env.PUBLIC_PRODUCT_NAME || "Club Content";
  const emailChannelPolicy = resolveNotificationChannelPolicy({
    notificationPolicy,
    type,
    channel: "email"
  });

  const delivery = emailChannelPolicy.enabled
    ? await sendEmailViaResend({
        toEmail: user.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        fromEmail: process.env.NOTIFICATION_FROM_EMAIL || "",
        resendApiKey: process.env.RESEND_API_KEY || ""
      })
    : {
        delivered: false,
        channel: "email",
        mode: "policy-disabled",
        reason: emailChannelPolicy.reason
      };

  await client.query(
    `
    INSERT INTO audit_logs (actor_user_id, entity_type, entity_id, action, metadata)
    VALUES ($1, 'notification', $2, $3, $4::jsonb)
    `,
    [
      actorUserId,
      notification.id,
      emailAuditAction(delivery),
      JSON.stringify({
        type,
        recipientEmail: user.email,
        delivery,
        notificationPolicy,
        payload
      })
    ]
  );

  if (!delivery.delivered) {
    console.log(
      isExpectedNotificationSkip(delivery)
        ? "notification email skipped"
        : "notification email failed",
      {
      notificationId: notification.id,
      to: user.email,
      type,
      reason: delivery.reason,
      mode: delivery.mode
      }
    );
  }

  const pushChannelPolicy = resolveNotificationChannelPolicy({
    notificationPolicy,
    type,
    channel: "push"
  });
  const pushRegistrations = pushChannelPolicy.enabled
    ? await listActivePushRegistrations(client, userId)
    : [];
  const pushContent = buildNotificationPush({
    type,
    payload,
    appName
  });
  const pushDelivery = pushChannelPolicy.enabled
    ? await sendPushNotifications({
        tokens: pushRegistrations.map((registration) => registration.pushToken),
        title: pushContent.title,
        body: pushContent.body,
        data: pushContent.data,
        enabled:
          String(process.env.PUSH_NOTIFICATIONS_ENABLED || "").toLowerCase() ===
          "true",
        provider: process.env.PUSH_PROVIDER || "expo",
        projectId: process.env.PUSH_PROJECT_ID || ""
      })
    : {
        delivered: false,
        channel: "push",
        mode: "policy-disabled",
        provider: process.env.PUSH_PROVIDER || "expo",
        attemptedCount: 0,
        successCount: 0,
        failureCount: 0,
        reason: pushChannelPolicy.reason
      };

  await client.query(
    `
    INSERT INTO audit_logs (actor_user_id, entity_type, entity_id, action, metadata)
    VALUES ($1, 'notification', $2, $3, $4::jsonb)
    `,
    [
      actorUserId,
      notification.id,
      pushAuditAction(pushDelivery),
      JSON.stringify({
        type,
        recipientEmail: user.email,
        tokenCount: pushRegistrations.length,
        delivery: pushDelivery,
        notificationPolicy,
        payload
      })
    ]
  );

  if (!pushDelivery.delivered) {
    console.log(
      isExpectedNotificationSkip(pushDelivery)
        ? "notification push skipped"
        : "notification push failed",
      {
      notificationId: notification.id,
      to: user.email,
      type,
      reason: pushDelivery.reason,
      mode: pushDelivery.mode
      }
    );
  }

  return {
    notification,
    delivery,
    deliveries: {
      email: delivery,
      push: pushDelivery
    }
  };
}

function pushAuditAction(delivery) {
  if (delivery.delivered) {
    return "notification.push.delivered";
  }

  if (["disabled", "no-recipients", "policy-disabled"].includes(delivery.mode)) {
    return "notification.push.skipped";
  }

  return "notification.push.failed";
}

async function listActivePushRegistrations(client, userId) {
  const result = await client.query(
    `
    WITH latest_push_state AS (
      SELECT DISTINCT ON (al.metadata->'push'->>'installationId')
        al.metadata->'push'->>'provider' AS provider,
        al.metadata->'push'->>'installationId' AS "installationId",
        al.metadata->'push'->>'pushToken' AS "pushToken",
        al.metadata->'push'->>'platform' AS platform,
        al.metadata->'push'->>'appId' AS "appId",
        al.metadata->'push'->>'environment' AS environment,
        al.metadata->'push'->>'deviceLabel' AS "deviceLabel",
        COALESCE((al.metadata->'push'->>'enabled')::boolean, false) AS enabled,
        al.created_at AS "updatedAt"
      FROM audit_logs al
      WHERE al.entity_type = 'user'
        AND al.entity_id = $1
        AND al.action IN ('push_token.upserted', 'push_token.revoked')
        AND COALESCE(al.metadata->'push'->>'installationId', '') <> ''
      ORDER BY al.metadata->'push'->>'installationId', al.created_at DESC
    )
    SELECT *
    FROM latest_push_state
    WHERE enabled = TRUE
      AND COALESCE("pushToken", '') <> ''
    ORDER BY "updatedAt" DESC
    `,
    [userId]
  );

  return result.rows;
}
