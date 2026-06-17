export function normalizeWebhookAction(type) {
  return String(type || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

export async function recordNotificationWebhookEvent(client, { event, verified = false }) {
  const webhookType = event?.type || "unknown";
  const emailId = event?.data?.email_id || null;
  const normalizedAction = normalizeWebhookAction(webhookType);
  const recipientEmail = Array.isArray(event?.data?.to)
    ? event.data.to[0] || null
    : event?.data?.to || null;

  let matchedNotificationId = null;

  if (emailId) {
    const match = await client.query(
      `
      SELECT entity_id AS "notificationId"
      FROM audit_logs
      WHERE entity_type = 'notification'
        AND action = 'notification.email.delivered'
        AND metadata->'delivery'->>'providerId' = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [emailId]
    );

    matchedNotificationId = match.rowCount ? match.rows[0].notificationId : null;
  }

  await client.query(
    `
    INSERT INTO audit_logs (entity_type, entity_id, action, metadata)
    VALUES ($1, $2, $3, $4::jsonb)
    `,
    [
      matchedNotificationId ? "notification" : "notification_webhook",
      matchedNotificationId,
      `notification.email.webhook.${normalizedAction}`,
      JSON.stringify({
        verified,
        webhookType,
        emailId,
        recipientEmail,
        createdAt: event?.created_at || null,
        data: event?.data || {},
        matchedNotificationId
      })
    ]
  );

  return {
    matchedNotificationId,
    verified,
    webhookType,
    emailId,
    recipientEmail,
    action: `notification.email.webhook.${normalizedAction}`
  };
}
