import assert from "node:assert/strict";
import test from "node:test";

import { loadSubmissionWorkflowDetail } from "./submission-workflow-detail.js";

test("loads latest submission workflow detail from the expected queries", async () => {
  const calls = [];
  const submissionId = "submission-1";
  const pool = {
    async query(query, values) {
      calls.push({ query, values });

      if (query.includes("FROM review_runs rr")) {
        return { rows: [{ id: "review-1", summary: "ready" }] };
      }

      if (query.includes("FROM approval_requests ar")) {
        return { rows: [{ id: "approval-1", state: "approved" }] };
      }

      if (query.includes("FROM published_posts pp")) {
        return { rows: [{ id: "post-1", destinationType: "internal_feed" }] };
      }

      throw new Error("unexpected query");
    }
  };

  const result = await loadSubmissionWorkflowDetail({ pool, submissionId });

  assert.deepEqual(result, {
    latestReviewRun: { id: "review-1", summary: "ready" },
    latestApprovalRequest: { id: "approval-1", state: "approved" },
    publishedPost: { id: "post-1", destinationType: "internal_feed" }
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.values),
    [[submissionId], [submissionId], [submissionId]]
  );
});

test("returns nulls when no workflow detail exists yet", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    }
  };

  const result = await loadSubmissionWorkflowDetail({
    pool,
    submissionId: "submission-2"
  });

  assert.deepEqual(result, {
    latestReviewRun: null,
    latestApprovalRequest: null,
    publishedPost: null
  });
});
