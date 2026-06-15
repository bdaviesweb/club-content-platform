const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApiError } = require("./apiErrors");

test("buildApiError uses API error details when available", async () => {
  const error = await buildApiError(
    {
      status: 404,
      json: async () => ({ error: "Unknown actedByEmail: reviewer@demo-club.local" })
    },
    "Review action failed"
  );

  assert.equal(error.message, "Unknown actedByEmail: reviewer@demo-club.local");
});

test("buildApiError falls back to a status message when no API error is available", async () => {
  const error = await buildApiError(
    {
      status: 500,
      json: async () => {
        throw new Error("not json");
      }
    },
    "Review action failed"
  );

  assert.equal(error.message, "Review action failed: 500");
});
