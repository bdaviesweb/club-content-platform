const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDemoSubmissionPayload,
  buildDemoSubmissionText,
  demoSubmissionPrefix
} = require("./demoTools");

test("buildDemoSubmissionText creates a stable demo marker", () => {
  assert.equal(
    buildDemoSubmissionText(new Date("2026-06-16T22:30:00.000Z")),
    `${demoSubmissionPrefix}-2026-06-16T22:30:00.000Z`
  );
});

test("buildDemoSubmissionPayload uses the real submission contract", () => {
  assert.deepEqual(
    buildDemoSubmissionPayload({
      clubSlug: "demo-soccer-club",
      teamSlug: "u14-girls",
      submitterEmail: "coach@demo-club.local",
      visibilityTarget: "internal",
      now: new Date("2026-06-16T22:30:00.000Z")
    }),
    {
      clubSlug: "demo-soccer-club",
      teamSlug: "u14-girls",
      submitterEmail: "coach@demo-club.local",
      contentType: "photo",
      rawText: "mobile-demo-post-2026-06-16T22:30:00.000Z",
      visibilityTarget: "internal",
      media: []
    }
  );
});
