import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublishedEventPayload,
  buildPublishedNotificationPayload,
  buildPublishFailureEventPayload,
  buildPublishFailureSummary
} from "./publish-outcome.js";

test("builds a stable publish failure summary", () => {
  assert.equal(
    buildPublishFailureSummary(new Error("Destination API timed out")),
    "Publishing failed: Destination API timed out"
  );
  assert.equal(
    buildPublishFailureSummary(),
    "Publishing failed: Unknown publishing failure"
  );
});

test("builds a stable publish failure event payload", () => {
  assert.deepEqual(buildPublishFailureEventPayload(new Error("Destination API timed out")), {
    error: "Destination API timed out"
  });
  assert.deepEqual(buildPublishFailureEventPayload(), {
    error: "Unknown publishing failure"
  });
});

test("builds published event payloads from publish results", () => {
  assert.deepEqual(
    buildPublishedEventPayload({
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed"
    }),
    {
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed"
    }
  );
});

test("builds published notification payloads from publish results", () => {
  assert.deepEqual(
    buildPublishedNotificationPayload({
      submissionId: "submission-1",
      result: {
        destinationType: "internal_feed",
        destinationName: "Internal Club Feed"
      }
    }),
    {
      submissionId: "submission-1",
      status: "published",
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed"
    }
  );
});
