const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractReadinessDefaults,
  fetchAppReadiness,
  formatCapability,
  shouldApplyReadinessDefault,
  summarizeAppReadiness
} = require("./appReadiness");

test("extractReadinessDefaults returns backend demo identities", () => {
  assert.deepEqual(
    extractReadinessDefaults({
      demo: {
        clubSlug: "demo-soccer-club",
        teamSlug: "u14-girls",
        submitterEmail: "coach@demo-club.local",
        reviewerEmail: "comms@demo-club.local"
      }
    }),
    {
      clubSlug: "demo-soccer-club",
      teamSlug: "u14-girls",
      submitterEmail: "coach@demo-club.local",
      reviewerEmail: "comms@demo-club.local"
    }
  );
});

test("shouldApplyReadinessDefault only replaces blank or fallback values", () => {
  assert.equal(shouldApplyReadinessDefault("", "fallback"), true);
  assert.equal(shouldApplyReadinessDefault("fallback", "fallback"), true);
  assert.equal(shouldApplyReadinessDefault("custom", "fallback"), false);
});

test("fetchAppReadiness loads the backend readiness endpoint", async () => {
  const payload = { capabilities: { review: true } };
  const result = await fetchAppReadiness("https://api.test/", async (url) => {
    assert.equal(url, "https://api.test/app/readiness");
    return {
      ok: true,
      json: async () => payload
    };
  });

  assert.equal(result, payload);
});

test("summarizeAppReadiness reports failed rule checks", () => {
  assert.equal(summarizeAppReadiness(null), "Not checked");
  assert.equal(
    summarizeAppReadiness({
      checks: [
        { key: "demo_club", ok: true },
        { key: "reviewer_membership", ok: false }
      ]
    }),
    "1 rule gap"
  );
  assert.equal(summarizeAppReadiness({ checks: [{ key: "demo_club", ok: true }] }), "Ready");
});

test("formatCapability renders simple readiness copy", () => {
  assert.equal(formatCapability(true), "Ready");
  assert.equal(formatCapability(false), "Not ready");
});
