import assert from "node:assert/strict";
import test from "node:test";

import { buildSubmissionDetail } from "./submission-detail.js";

test("builds submission detail with nested workflow records", () => {
  const result = buildSubmissionDetail({
    submission: {
      id: "submission-1",
      status: "published",
      media: [{ id: "media-1", previewUrl: "https://example.com/1.jpg" }]
    },
    latestReviewRun: {
      id: "review-1",
      agentName: "hermes",
      model: "llama3.2",
      resultStatus: "approved",
      confidence: 0.94,
      summary: "Looks good",
      createdAt: "2026-06-17T10:00:00.000Z"
    },
    latestApprovalRequest: {
      id: "approval-1",
      state: "approved",
      approverRole: "club_admin",
      approverName: "Coach Alex",
      latestAction: {
        id: "action-1",
        action: "approved",
        notes: "Ready to publish",
        reasonCode: "policy_ok"
      }
    },
    publishedPost: {
      id: "post-1",
      externalPostId: "feed-1",
      publishedAt: "2026-06-17T10:05:00.000Z",
      destinationName: "Internal Club Feed",
      destinationType: "internal_feed"
    }
  });

  assert.equal(result.id, "submission-1");
  assert.equal(result.status, "published");
  assert.equal(result.latestReviewRun.summary, "Looks good");
  assert.equal(result.latestApprovalRequest.latestAction.reasonCode, "policy_ok");
  assert.equal(result.publishedPost.destinationName, "Internal Club Feed");
  assert.equal(result.publishedPost.destinationType, "internal_feed");
});

test("fills missing workflow detail with nulls", () => {
  const submission = {
    id: "submission-2",
    status: "pending_review",
    media: []
  };

  const result = buildSubmissionDetail({
    submission,
    latestReviewRun: undefined,
    latestApprovalRequest: null,
    publishedPost: undefined
  });

  assert.deepEqual(result, {
    ...submission,
    latestReviewRun: null,
    latestApprovalRequest: null,
    publishedPost: null
  });
});
