export function buildWebhookSignatureError(error) {
  return {
    error: "Invalid webhook signature",
    detail: error instanceof Error ? error.message : "signature_verification_failed"
  };
}

export function extractSvixHeaders(headers = {}) {
  return {
    "svix-id": headers["svix-id"],
    "svix-timestamp": headers["svix-timestamp"],
    "svix-signature": headers["svix-signature"]
  };
}

export function parseResendWebhook({
  rawBody,
  resendWebhookSecret = "",
  headers = {},
  verifySignature
}) {
  if (!rawBody) {
    return {
      ok: false,
      status: 400,
      payload: { error: "Webhook body is required" }
    };
  }

  if (!resendWebhookSecret) {
    return {
      ok: true,
      verified: false,
      event: JSON.parse(rawBody)
    };
  }

  try {
    const event = verifySignature(rawBody, extractSvixHeaders(headers));
    return {
      ok: true,
      verified: true,
      event
    };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      payload: buildWebhookSignatureError(error)
    };
  }
}
