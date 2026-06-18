import assert from "node:assert/strict";
import test from "node:test";

import { loadSubmissionRecord } from "./submission-record.js";

test("returns null when the submission is missing", async () => {
  const pool = {
    async query(query) {
      if (query.includes("FROM submissions s")) {
        return { rowCount: 0, rows: [] };
      }

      throw new Error("unexpected query for missing submission");
    }
  };

  const result = await loadSubmissionRecord({
    pool,
    submissionId: "missing-submission",
    enrichMediaCollection(items) {
      return items;
    }
  });

  assert.equal(result, null);
});

test("builds a combined submission detail record from base and workflow queries", async () => {
  const submissionId = "submission-1";
  const pool = {
    async query(query, values) {
      assert.deepEqual(values, [submissionId]);

      if (query.includes("FROM submissions s")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: submissionId,
              status: "published",
              media: [{ id: "media-1", objectKey: "uploads/poster.jpg" }]
            }
          ]
        };
      }

      if (query.includes("FROM review_runs rr")) {
        return { rows: [{ id: "review-1", summary: "approved by Hermes" }] };
      }

      if (query.includes("FROM approval_requests ar")) {
        return { rows: [{ id: "approval-1", state: "approved" }] };
      }

      if (query.includes("FROM published_posts pp")) {
        return {
          rows: [{ id: "post-1", destinationName: "Internal Club Feed" }]
        };
      }

      throw new Error("unexpected query");
    }
  };

  const result = await loadSubmissionRecord({
    pool,
    submissionId,
    enrichMediaCollection(items) {
      return items.map((item) => ({
        ...item,
        previewUrl: "https://clubcontent-uploads.davmn.net/uploads/poster.jpg"
      }));
    }
  });

  assert.deepEqual(result, {
    id: submissionId,
    status: "published",
    media: [
      {
        id: "media-1",
        objectKey: "uploads/poster.jpg",
        previewUrl: "https://clubcontent-uploads.davmn.net/uploads/poster.jpg"
      }
    ],
    latestReviewRun: { id: "review-1", summary: "approved by Hermes" },
    latestApprovalRequest: { id: "approval-1", state: "approved" },
    publishedPost: { id: "post-1", destinationName: "Internal Club Feed" }
  });
});
