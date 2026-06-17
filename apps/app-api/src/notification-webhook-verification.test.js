import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWebhookSignatureError,
  extractSvixHeaders,
  parseResendWebhook
} from "./notification-webhook-verification.js";

test("extracts svix headers for verification", () => {
  assert.deepEqual(
    extractSvixHeaders({
      "svix-id": "msg_123",
      "svix-timestamp": "1234567890",
      "svix-signature": "v1,test",
      other: "ignored"
    }),
    {
      "svix-id": "msg_123",
      "svix-timestamp": "1234567890",
      "svix-signature": "v1,test"
    }
  );
});

test("reports a required body error for empty webhook payloads", () => {
  const result = parseResendWebhook({
    rawBody: "",
    resendWebhookSecret: "",
    headers: {}
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    payload: { error: "Webhook body is required" }
  });
});

test("parses unsigned dev webhook payloads without verification", () => {
  const result = parseResendWebhook({
    rawBody: JSON.stringify({
      type: "email.delivered",
      data: { email_id: "email-1" }
    }),
    resendWebhookSecret: "",
    headers: {},
    verifySignature() {
      throw new Error("should not be called");
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.verified, false);
  assert.equal(result.event.type, "email.delivered");
  assert.equal(result.event.data.email_id, "email-1");
});

test("returns a structured invalid signature error when verification fails", () => {
  const result = parseResendWebhook({
    rawBody: '{"type":"email.delivered"}',
    resendWebhookSecret: "webhook-secret",
    headers: {
      "svix-id": "msg_123",
      "svix-timestamp": "1234567890",
      "svix-signature": "bad-signature"
    },
    verifySignature() {
      throw new Error("signature mismatch");
    }
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    payload: buildWebhookSignatureError(new Error("signature mismatch"))
  });
});

test("returns verified webhook events when signature verification succeeds", () => {
  const expectedEvent = {
    type: "email.delivered",
    data: { email_id: "email-2" }
  };

  const result = parseResendWebhook({
    rawBody: '{"type":"email.delivered"}',
    resendWebhookSecret: "webhook-secret",
    headers: {
      "svix-id": "msg_456",
      "svix-timestamp": "1234567891",
      "svix-signature": "good-signature"
    },
    verifySignature(rawBody, headers) {
      assert.equal(rawBody, '{"type":"email.delivered"}');
      assert.deepEqual(headers, {
        "svix-id": "msg_456",
        "svix-timestamp": "1234567891",
        "svix-signature": "good-signature"
      });
      return expectedEvent;
    }
  });

  assert.deepEqual(result, {
    ok: true,
    verified: true,
    event: expectedEvent
  });
});
