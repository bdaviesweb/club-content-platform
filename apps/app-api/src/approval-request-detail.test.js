import assert from "node:assert/strict";
import test from "node:test";

import { loadApprovalRequestDetail } from "./approval-request-detail.js";

test("returns null when the approval request does not exist", async () => {
  const pool = {
    async query() {
      return {
        rowCount: 0,
        rows: []
      };
    }
  };

  const result = await loadApprovalRequestDetail({
    pool,
    approvalRequestId: "missing-approval"
  });

  assert.equal(result, null);
});

test("loads approval request detail and enriches submission media", async () => {
  const approvalRequestId = "approval-1";
  const media = [{ id: "media-1", objectKey: "uploads/approval.jpg" }];
  const pool = {
    async query(query, values) {
      assert.match(query, /FROM approval_requests ar/);
      assert.deepEqual(values, [approvalRequestId]);
      return {
        rowCount: 1,
        rows: [
          {
            id: approvalRequestId,
            state: "pending",
            approver_role: "club_admin",
            submission_id: "submission-1",
            submission_status: "pending_approval",
            raw_text: "Ready for review",
            approver_name: "Coach Alex",
            media,
            review_runs: [
              {
                id: "review-1",
                summary: "Looks good",
                rawOutput: { decision: "approve" },
                findings: [{ id: "finding-1", message: "Approved", metadata: { tag: "ok" } }]
              }
            ],
            approval_actions: [
              {
                id: "action-1",
                action: "request_changes",
                reasonCode: "caption_missing"
              }
            ]
          }
        ]
      };
    }
  };

  const result = await loadApprovalRequestDetail({
    pool,
    approvalRequestId,
    enrichMediaCollection(items) {
      assert.deepEqual(items, media);
      return items.map((item) => ({
        ...item,
        previewUrl: "https://clubcontent-uploads.davmn.net/uploads/approval.jpg"
      }));
    }
  });

  assert.deepEqual(result, {
    id: approvalRequestId,
    state: "pending",
    approver_role: "club_admin",
    submission_id: "submission-1",
    submission_status: "pending_approval",
    raw_text: "Ready for review",
    approver_name: "Coach Alex",
    media: [
      {
        id: "media-1",
        objectKey: "uploads/approval.jpg",
        previewUrl: "https://clubcontent-uploads.davmn.net/uploads/approval.jpg"
      }
    ],
    review_runs: [
      {
        id: "review-1",
        summary: "Looks good",
        rawOutput: { decision: "approve" },
        findings: [{ id: "finding-1", message: "Approved", metadata: { tag: "ok" } }]
      }
    ],
    approval_actions: [
      {
        id: "action-1",
        action: "request_changes",
        reasonCode: "caption_missing"
      }
    ]
  });
});
