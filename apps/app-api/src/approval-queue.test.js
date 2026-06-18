import assert from "node:assert/strict";
import test from "node:test";

import { loadApprovalQueue } from "./approval-queue.js";

test("returns an empty approval queue when no pending requests exist", async () => {
  const pool = {
    async query(query) {
      assert.match(query, /FROM approval_requests ar/);
      return { rows: [] };
    }
  };

  const result = await loadApprovalQueue({ pool });

  assert.deepEqual(result, []);
});

test("loads pending approval queue items in created order", async () => {
  const rows = [
    {
      id: "approval-1",
      state: "pending",
      stage: "primary",
      submission_id: "submission-1",
      submission_status: "pending_approval",
      raw_text: "Post 1",
      risk_score: 0.14,
      approverRole: "club_admin",
      routing_decision: { reviewMode: "hermes" },
      approver_name: "Alex",
      latest_review_summary: "Looks good"
    },
    {
      id: "approval-2",
      state: "pending",
      stage: "secondary",
      submission_id: "submission-2",
      submission_status: "pending_approval",
      raw_text: "Post 2",
      risk_score: 0.32,
      approverRole: "club_comms",
      routing_decision: { reviewMode: "manual" },
      approver_name: "Morgan",
      latest_review_summary: null
    }
  ];
  const pool = {
    async query(query) {
      assert.match(query, /ORDER BY ar\.created_at ASC/);
      return { rows };
    }
  };

  const result = await loadApprovalQueue({ pool });

  assert.deepEqual(result, rows);
});
