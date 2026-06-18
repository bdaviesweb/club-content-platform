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
      results: [
        {
          destinationType: "internal_feed",
          destinationName: "Internal Club Feed"
        },
        {
          destinationType: "booster_email",
          destinationName: "Booster Email"
        }
      ]
    }),
    {
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed",
      destinationCount: 2,
      destinations: [
        {
          destinationType: "internal_feed",
          destinationName: "Internal Club Feed"
        },
        {
          destinationType: "booster_email",
          destinationName: "Booster Email"
        }
      ]
    }
  );
});

test("builds published notification payloads from publish results", () => {
  assert.deepEqual(
    buildPublishedNotificationPayload({
      submissionId: "submission-1",
      result: {
        results: [
          {
            destinationType: "internal_feed",
            destinationName: "Internal Club Feed"
          },
          {
            destinationType: "booster_email",
            destinationName: "Booster Email"
          }
        ]
      }
    }),
    {
      submissionId: "submission-1",
      status: "published",
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed",
      destinationCount: 2,
      destinations: [
        {
          destinationType: "internal_feed",
          destinationName: "Internal Club Feed"
        },
        {
          destinationType: "booster_email",
          destinationName: "Booster Email"
        }
      ]
    }
  );
});
