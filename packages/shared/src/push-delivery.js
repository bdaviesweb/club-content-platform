const expoPushEndpoint =
  process.env.EXPO_PUSH_ENDPOINT || "https://exp.host/--/api/v2/push/send";

export function describePushDeliveryConfig({
  enabled = false,
  provider = "expo",
  projectId = ""
} = {}) {
  if (!enabled) {
    return {
      provider,
      enabled: false,
      mode: "disabled",
      reason: "push_disabled",
      projectIdConfigured: Boolean(projectId),
      projectId: projectId || null
    };
  }

  if (provider !== "expo") {
    return {
      provider,
      enabled: true,
      mode: "unsupported-provider",
      reason: `unsupported_push_provider:${provider}`,
      projectIdConfigured: Boolean(projectId),
      projectId: projectId || null
    };
  }

  return {
    provider,
    enabled: true,
    mode: "expo",
    reason: projectId ? null : "missing_project_id",
    projectIdConfigured: Boolean(projectId),
    projectId: projectId || null
  };
}

function normalizeTokens(tokens) {
  return [...new Set((tokens || []).map((token) => String(token || "").trim()).filter(Boolean))];
}

function normalizeExpoResponse(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (payload?.data) {
    return [payload.data];
  }

  return [];
}

export async function sendPushNotifications({
  tokens,
  title,
  body,
  data = {},
  enabled = false,
  provider = "expo",
  projectId = "",
  fetchImpl = globalThis.fetch
}) {
  const uniqueTokens = normalizeTokens(tokens);

  if (!enabled) {
    return {
      delivered: false,
      channel: "push",
      mode: "disabled",
      provider,
      attemptedCount: 0,
      successCount: 0,
      failureCount: 0,
      reason: "push_disabled"
    };
  }

  if (!uniqueTokens.length) {
    return {
      delivered: false,
      channel: "push",
      mode: "no-recipients",
      provider,
      attemptedCount: 0,
      successCount: 0,
      failureCount: 0,
      reason: "no_push_tokens"
    };
  }

  if (provider !== "expo") {
    return {
      delivered: false,
      channel: "push",
      mode: "unsupported-provider",
      provider,
      attemptedCount: uniqueTokens.length,
      successCount: 0,
      failureCount: uniqueTokens.length,
      reason: `unsupported_push_provider:${provider}`
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      delivered: false,
      channel: "push",
      mode: "expo",
      provider,
      attemptedCount: uniqueTokens.length,
      successCount: 0,
      failureCount: uniqueTokens.length,
      reason: "fetch_unavailable"
    };
  }

  const messages = uniqueTokens.map((token) => ({
    to: token,
    title,
    body,
    data: {
      ...data,
      projectId: projectId || undefined
    },
    sound: "default"
  }));

  try {
    const response = await fetchImpl(expoPushEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(messages)
    });

    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        delivered: false,
        channel: "push",
        mode: "expo",
        provider,
        attemptedCount: uniqueTokens.length,
        successCount: 0,
        failureCount: uniqueTokens.length,
        reason: responsePayload.message || `expo_${response.status}`,
        providerResponse: responsePayload
      };
    }

    const tickets = normalizeExpoResponse(responsePayload);
    const successCount = tickets.filter((ticket) => ticket?.status === "ok").length;
    const failureCount = uniqueTokens.length - successCount;

    return {
      delivered: successCount > 0,
      channel: "push",
      mode: "expo",
      provider,
      attemptedCount: uniqueTokens.length,
      successCount,
      failureCount,
      reason: successCount > 0 ? null : "expo_no_successful_tickets",
      tickets
    };
  } catch (error) {
    return {
      delivered: false,
      channel: "push",
      mode: "expo",
      provider,
      attemptedCount: uniqueTokens.length,
      successCount: 0,
      failureCount: uniqueTokens.length,
      reason: error instanceof Error ? error.message : "expo_push_failed"
    };
  }
}
