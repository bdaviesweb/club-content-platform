const assert = require("node:assert/strict");
const test = require("node:test");

const {
  countStatuses,
  formatApiConnectionLabel,
  formatApprovalRoleLabel,
  formatStatusLabel,
  formatRoutingSourceLabel,
  getProgressStageState,
  getStatusTone,
  normalizeSubmissionStatus,
  summarizeSubmissionProgress
} = require("./statusHelpers");

test("normalizes backend workflow statuses for mobile copy", () => {
  assert.equal(normalizeSubmissionStatus("received"), "submitted");
  assert.equal(normalizeSubmissionStatus("approved_internal"), "approved");
  assert.equal(formatStatusLabel("received"), "Received");
  assert.equal(formatStatusLabel("approved_internal"), "Approved");
});

test("explains publish failures without exposing backend state names", () => {
  assert.equal(formatStatusLabel("publish_failed"), "Publish Needs Help");
  assert.equal(getStatusTone("publish_failed"), "attention");
  assert.equal(
    summarizeSubmissionProgress({ status: "publish_failed" }),
    "Approved, but publishing needs admin follow-up."
  );
});

test("formats Hermes routing sources for the submitter detail view", () => {
  assert.equal(formatRoutingSourceLabel("hermes_agent"), "Hermes");
  assert.equal(formatRoutingSourceLabel("local_rules"), "Local rules");
  assert.equal(formatRoutingSourceLabel("fallback_router"), "Fallback Router");
});

test("formats reviewer roles for routing badges", () => {
  assert.equal(formatApprovalRoleLabel("club_admin"), "Club Admin");
  assert.equal(formatApprovalRoleLabel("club_comms"), "Club Comms");
  assert.equal(formatApprovalRoleLabel(""), "n/a");
});

test("labels hosted and local API connections clearly", () => {
  assert.equal(
    formatApiConnectionLabel("https://clubcontent-api.davmn.net/"),
    "Hosted dev VPS"
  );
  assert.equal(formatApiConnectionLabel("http://localhost:4000"), "Local backend");
  assert.equal(formatApiConnectionLabel(""), "Not set");
});

test("counts statuses using the mobile-facing workflow buckets", () => {
  assert.deepEqual(
    countStatuses([
      { status: "received" },
      { status: "needs_human_review" },
      { status: "approved_internal" },
      { status: "published" },
      { status: "publish_failed" }
    ]),
    {
      total: 5,
      published: 1,
      inReview: 1,
      needsAttention: 1
    }
  );
});

test("maps workflow-only statuses onto the progress rail", () => {
  assert.equal(getProgressStageState("approved_internal", "submitted"), "complete");
  assert.equal(getProgressStageState("approved_internal", "approved"), "current");
  assert.equal(getProgressStageState("publish_failed", "needs_human_review"), "complete");
  assert.equal(getProgressStageState("publish_failed", "approved"), "current");
  assert.equal(getProgressStageState("publish_failed", "published"), "pending");
});
