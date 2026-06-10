import assert from "node:assert/strict";
import test from "node:test";
import { sendPushNotifications } from "./push-delivery.js";

test("skips delivery when push is disabled", async () => {
  const result = await sendPushNotifications({
    enabled: false,
    tokens: ["ExponentPushToken[test]"],
    title: "Title",
    body: "Body"
  });

  assert.equal(result.delivered, false);
  assert.equal(result.mode, "disabled");
  assert.equal(result.reason, "push_disabled");
  assert.equal(result.attemptedCount, 0);
});

test("skips delivery when no recipient tokens exist", async () => {
  const result = await sendPushNotifications({
    enabled: true,
    tokens: [],
    title: "Title",
    body: "Body"
  });

  assert.equal(result.delivered, false);
  assert.equal(result.mode, "no-recipients");
  assert.equal(result.reason, "no_push_tokens");
});

test("returns unsupported provider failures without network calls", async () => {
  let called = false;
  const result = await sendPushNotifications({
    enabled: true,
    provider: "apns",
    tokens: ["token-1"],
    title: "Title",
    body: "Body",
    fetchImpl: async () => {
      called = true;
    }
  });

  assert.equal(called, false);
  assert.equal(result.delivered, false);
  assert.equal(result.mode, "unsupported-provider");
  assert.equal(result.failureCount, 1);
});

test("sends unique Expo tokens and reports ticket counts", async () => {
  const requests = [];
  const result = await sendPushNotifications({
    enabled: true,
    provider: "expo",
    projectId: "project-1",
    tokens: ["ExponentPushToken[a]", "ExponentPushToken[a]", "ExponentPushToken[b]"],
    title: "Club Content: Review started",
    body: "Your update is in review.",
    data: { submissionId: "submission-1" },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        async json() {
          return {
            data: [
              { status: "ok", id: "ticket-1" },
              { status: "error", message: "DeviceNotRegistered" }
            ]
          };
        }
      };
    }
  });

  assert.equal(result.delivered, true);
  assert.equal(result.attemptedCount, 2);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://exp.host/--/api/v2/push/send");

  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.length, 2);
  assert.equal(body[0].to, "ExponentPushToken[a]");
  assert.equal(body[0].data.submissionId, "submission-1");
  assert.equal(body[0].data.projectId, "project-1");
});

test("reports Expo HTTP failures as structured failures", async () => {
  const result = await sendPushNotifications({
    enabled: true,
    tokens: ["ExponentPushToken[a]"],
    title: "Title",
    body: "Body",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async json() {
        return { message: "rate limited" };
      }
    })
  });

  assert.equal(result.delivered, false);
  assert.equal(result.mode, "expo");
  assert.equal(result.reason, "rate limited");
  assert.equal(result.failureCount, 1);
});
