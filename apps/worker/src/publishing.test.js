import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublishingAdapter,
  publishToDestination
} from "./publishing.js";

test("publishes internal feed destinations through the internal adapter", async () => {
  const result = await publishToDestination({
    submission: { id: "submission-1" },
    destination: {
      id: "destination-1",
      destination_type: "internal_feed",
      name: "Internal Club Feed",
      config: { mode: "internal" }
    }
  });

  assert.equal(result.destinationType, "internal_feed");
  assert.equal(result.destinationName, "Internal Club Feed");
  assert.equal(result.externalPostId, "internal:submission-1");
  assert.equal(result.externalReference, "internal:submission-1");
  assert.equal(result.resultSummary, "Published to internal feed by worker");
});

test("requires an adapter for each destination type", () => {
  assert.throws(
    () => getPublishingAdapter("instagram"),
    /Publishing adapter not configured for instagram/
  );
});
