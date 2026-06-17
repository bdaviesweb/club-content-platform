import assert from "node:assert/strict";
import test from "node:test";

import { summarizeReviewHandoff } from "./reviewHandoff.js";

test("summarizes pending reviewer handoff", () => {
  assert.deepEqual(
    summarizeReviewHandoff({
      submission_status: "needs_human_review",
      visibility_target: "internal",
      approverRole: "club_comms"
    }),
    {
      label: "Reviewer handoff",
      title: "Waiting on Club Comms",
      body: "The submitter is done for now. Approval sends this toward Internal Club Feed."
    }
  );
});

test("summarizes published handoff completion", () => {
  assert.deepEqual(
    summarizeReviewHandoff({
      submission_status: "published",
      publishedPost: { destinationName: "Internal Club Feed" }
    }),
    {
      label: "Handoff complete",
      title: "Live in Internal Club Feed",
      body: "The submitter can now share it or confirm it in the feed."
    }
  );
});

test("summarizes submitter-owned updates", () => {
  assert.equal(
    summarizeReviewHandoff({ submission_status: "needs_metadata" }).label,
    "Submitter handoff"
  );
});
