import assert from "node:assert/strict";
import test from "node:test";

import { loadSubmissionBase } from "./submission-base.js";

test("loads a submission and enriches its media collection", async () => {
  const submissionId = "submission-1";
  const media = [{ id: "media-1", objectKey: "uploads/test.jpg" }];
  const pool = {
    async query(query, values) {
      assert.match(query, /FROM submissions s/);
      assert.deepEqual(values, [submissionId]);
      return {
        rowCount: 1,
        rows: [{ id: submissionId, status: "pending_review", media }]
      };
    }
  };

  const result = await loadSubmissionBase({
    pool,
    submissionId,
    enrichMediaCollection(items) {
      assert.deepEqual(items, media);
      return items.map((item) => ({ ...item, previewUrl: "https://example.test/1.jpg" }));
    }
  });

  assert.deepEqual(result, {
    id: submissionId,
    status: "pending_review",
    media: [{ id: "media-1", objectKey: "uploads/test.jpg", previewUrl: "https://example.test/1.jpg" }]
  });
});

test("returns null when the submission does not exist", async () => {
  const pool = {
    async query() {
      return {
        rowCount: 0,
        rows: []
      };
    }
  };

  const result = await loadSubmissionBase({
    pool,
    submissionId: "missing-submission"
  });

  assert.equal(result, null);
});
