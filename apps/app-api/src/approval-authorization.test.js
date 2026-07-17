import assert from "node:assert/strict";
import test from "node:test";

import {
  isReviewerRole,
  loadAuthorizedApprovalActor
} from "./approval-authorization.js";

function createClient({ approvalRequest, actor, membership } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });

      if (String(sql).includes("FROM approval_requests")) {
        return approvalRequest
          ? { rowCount: 1, rows: [approvalRequest] }
          : { rowCount: 0, rows: [] };
      }

      if (String(sql).includes("FROM users")) {
        return actor ? { rowCount: 1, rows: [actor] } : { rowCount: 0, rows: [] };
      }

      if (String(sql).includes("FROM memberships")) {
        return membership
          ? { rowCount: 1, rows: [membership] }
          : { rowCount: 0, rows: [] };
      }

      return { rowCount: 0, rows: [] };
    }
  };
}

const approvalRequest = {
  id: "approval-1",
  club_id: "club-1",
  team_id: "team-1",
  submission_id: "submission-1",
  submitted_by_user_id: "submitter-1",
  approver_role: "club_comms"
};

test("identifies reviewer roles", () => {
  assert.equal(isReviewerRole("team_manager"), true);
  assert.equal(isReviewerRole("club_comms"), true);
  assert.equal(isReviewerRole("club_admin"), true);
  assert.equal(isReviewerRole("submitter_parent"), false);
});

test("allows assigned team manager membership", async () => {
  const client = createClient({
    approvalRequest: {
      ...approvalRequest,
      approver_role: "team_manager"
    },
    actor: { id: "manager-1", email: "manager@example.com" },
    membership: { id: "membership-1", role: "team_manager" }
  });

  const result = await loadAuthorizedApprovalActor(
    client,
    "approval-1",
    "manager@example.com"
  );

  assert.equal(result.authorized, true);
  assert.equal(result.actorRole, "team_manager");
  assert.deepEqual(client.queries[2].params[2], ["team_manager", "club_admin"]);
});

test("allows assigned reviewer membership", async () => {
  const client = createClient({
    approvalRequest,
    actor: { id: "reviewer-1", email: "reviewer@example.com" },
    membership: { id: "membership-1", role: "club_comms" }
  });

  const result = await loadAuthorizedApprovalActor(
    client,
    "approval-1",
    " reviewer@example.com "
  );

  assert.equal(result.authorized, true);
  assert.equal(result.actor.id, "reviewer-1");
  assert.equal(result.actorRole, "club_comms");
  assert.deepEqual(client.queries[2].params[2], ["club_comms", "club_admin"]);
});

test("rejects submitter-only actors", async () => {
  const client = createClient({
    approvalRequest,
    actor: { id: "submitter-1", email: "parent@example.com" }
  });

  const result = await loadAuthorizedApprovalActor(
    client,
    "approval-1",
    "parent@example.com"
  );

  assert.equal(result.authorized, false);
  assert.equal(result.status, 403);
});

test("returns not found when the approval request does not exist", async () => {
  const client = createClient();

  const result = await loadAuthorizedApprovalActor(
    client,
    "missing",
    "reviewer@example.com"
  );

  assert.deepEqual(result, { found: false });
  assert.equal(client.queries.length, 1);
});
