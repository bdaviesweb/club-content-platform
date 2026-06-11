const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMobileRolePolicy,
  normalizeRoleMode
} = require("./rolePolicy");

test("defaults unknown modes to submitter", () => {
  assert.equal(normalizeRoleMode(), "submitter");
  assert.equal(normalizeRoleMode("parent"), "submitter");
  assert.equal(normalizeRoleMode("reviewer"), "reviewer");
  assert.equal(normalizeRoleMode("admin"), "reviewer");
});

test("submitter mode can post and track but cannot review", () => {
  const policy = buildMobileRolePolicy({
    mode: "submitter",
    submitterEmail: " parent@example.com ",
    reviewerEmail: "reviewer@example.com"
  });

  assert.equal(policy.mode, "submitter");
  assert.equal(policy.label, "Submitter");
  assert.equal(policy.submitterEmail, "parent@example.com");
  assert.equal(policy.canSubmit, true);
  assert.equal(policy.canTrackSubmissions, true);
  assert.equal(policy.canReview, false);
  assert.equal(policy.showReviewTools, false);
  assert.equal(policy.reviewActorEmail, "");
});

test("reviewer mode requires a reviewer email before actions are enabled", () => {
  assert.equal(
    buildMobileRolePolicy({
      mode: "reviewer",
      submitterEmail: "parent@example.com"
    }).canReview,
    false
  );

  const policy = buildMobileRolePolicy({
    mode: "reviewer",
    submitterEmail: "parent@example.com",
    reviewerEmail: " reviewer@example.com "
  });

  assert.equal(policy.mode, "reviewer");
  assert.equal(policy.label, "Reviewer");
  assert.equal(policy.canReview, true);
  assert.equal(policy.showReviewTools, true);
  assert.equal(policy.reviewActorEmail, "reviewer@example.com");
  assert.equal(policy.notificationEmail, "parent@example.com");
});
