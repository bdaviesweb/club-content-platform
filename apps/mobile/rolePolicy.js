const submitterMode = "submitter";
const reviewerMode = "reviewer";

function normalizeRoleMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["reviewer", "admin", "review"].includes(normalized)) return reviewerMode;
  return submitterMode;
}

function buildMobileRolePolicy({ mode, submitterEmail, reviewerEmail } = {}) {
  const roleMode = normalizeRoleMode(mode);
  const normalizedSubmitterEmail = String(submitterEmail || "").trim();
  const normalizedReviewerEmail = String(reviewerEmail || "").trim();
  const isReviewerMode = roleMode === reviewerMode;

  return {
    mode: roleMode,
    label: isReviewerMode ? "Reviewer" : "Submitter",
    submitterEmail: normalizedSubmitterEmail,
    reviewerEmail: normalizedReviewerEmail,
    canSubmit: Boolean(normalizedSubmitterEmail),
    canTrackSubmissions: Boolean(normalizedSubmitterEmail),
    canReview: Boolean(isReviewerMode && normalizedReviewerEmail),
    showReviewTools: isReviewerMode,
    notificationEmail: normalizedSubmitterEmail,
    reviewActorEmail: isReviewerMode ? normalizedReviewerEmail : ""
  };
}

module.exports = {
  buildMobileRolePolicy,
  normalizeRoleMode,
  reviewerMode,
  submitterMode
};
