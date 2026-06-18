import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkflowEventsWhereClause,
  loadWorkflowEvents
} from "./workflow-events.js";

test("builds no filter for all workflow events", () => {
  assert.equal(buildWorkflowEventsWhereClause("all"), "");
  assert.equal(buildWorkflowEventsWhereClause(null), "");
});

test("builds the pending workflow events filter", () => {
  assert.equal(
    buildWorkflowEventsWhereClause("pending"),
    "WHERE processed_at IS NULL"
  );
});

test("builds the failed workflow events filter", () => {
  assert.equal(
    buildWorkflowEventsWhereClause("failed"),
    "WHERE processed_at IS NOT NULL AND processing_error IS NOT NULL"
  );
});

test("loads workflow events with the selected filter", async () => {
  const rows = [
    {
      id: "event-1",
      submission_id: "submission-1",
      event_name: "submission_review_started",
      processing_error: null
    }
  ];

  const pool = {
    async query(query) {
      assert.match(query, /FROM submission_events se/);
      assert.match(query, /WHERE processed_at IS NULL/);
      assert.match(query, /ORDER BY se\.created_at DESC/);
      return { rows };
    }
  };

  const result = await loadWorkflowEvents({ pool, status: "pending" });

  assert.deepEqual(result, rows);
});
