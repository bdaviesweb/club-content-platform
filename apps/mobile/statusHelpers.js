const progressStages = [
  { key: "submitted", label: "Received" },
  { key: "needs_human_review", label: "Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Posted" }
];

function normalizeSubmissionStatus(value) {
  const normalized = String(value || "submitted").toLowerCase();
  if (normalized === "received") return "submitted";
  if (normalized === "approved_internal") return "approved";
  return normalized;
}

function formatStatusLabel(value) {
  const normalized = normalizeSubmissionStatus(value);
  switch (normalized) {
    case "submitted":
      return "Received";
    case "needs_human_review":
      return "In Review";
    case "approved":
      return "Approved";
    case "published":
      return "Posted";
    case "publish_failed":
      return "Publish Needs Help";
    case "rejected":
      return "Not Approved";
    case "changes_requested":
      return "Needs Changes";
    case "needs_metadata":
      return "Needs Detail";
    default:
      return normalized
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

function formatRoutingSourceLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "Local rules";
  }
  if (normalized === "hermes_agent") {
    return "Hermes";
  }
  if (normalized === "local_rules") {
    return "Local rules";
  }

  return normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatApprovalRoleLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "n/a";
  }

  return normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatApiConnectionLabel(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "").toLowerCase();
  if (!normalized) {
    return "Not set";
  }
  if (isHostedDevApiBaseUrl(normalized)) {
    return "Hosted dev VPS";
  }
  if (
    normalized.startsWith("http://localhost") ||
    normalized.startsWith("https://localhost") ||
    normalized.startsWith("http://127.0.0.1") ||
    normalized.startsWith("https://127.0.0.1")
  ) {
    return "Local backend";
  }

  return normalized;
}

function isHostedDevApiBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "").toLowerCase();
  return normalized.includes("clubcontent-api.davmn.net");
}

function formatBackendConnectionCopy(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "").toLowerCase();
  if (!normalized) {
    return "API base URL not set.";
  }
  if (isHostedDevApiBaseUrl(normalized)) {
    return "Hosted dev VPS selected for TestFlight and device QA.";
  }
  if (
    normalized.startsWith("http://localhost") ||
    normalized.startsWith("https://localhost") ||
    normalized.startsWith("http://127.0.0.1") ||
    normalized.startsWith("https://127.0.0.1")
  ) {
    return "Local backend selected for debugging.";
  }

  return `Connected to ${normalized}.`;
}

function getStatusTone(value) {
  const normalized = normalizeSubmissionStatus(value);
  if (["published", "approved"].includes(normalized)) return "success";
  if (
    ["publish_failed", "rejected", "changes_requested", "needs_metadata"].includes(
      normalized
    )
  ) {
    return "attention";
  }
  if (normalized === "needs_human_review") return "info";
  return "neutral";
}

function summarizeSubmissionProgress(item) {
  const status = normalizeSubmissionStatus(item?.status);
  if (status === "published") return "Approved and shared to the club feed.";
  if (status === "approved") return "Approved and waiting for publishing.";
  if (status === "publish_failed") {
    return "Approved, but publishing needs admin follow-up.";
  }
  if (status === "rejected") return "Stopped in review.";
  if (status === "changes_requested" || status === "needs_metadata") {
    return "Needs an update before it can move forward.";
  }
  if (status === "needs_human_review") return "A reviewer is looking at it now.";
  return "Captured and waiting to enter review.";
}

function countStatuses(items) {
  return items.reduce(
    (accumulator, item) => {
      const status = normalizeSubmissionStatus(item?.status);
      accumulator.total += 1;
      if (status === "published") accumulator.published += 1;
      if (status === "needs_human_review") accumulator.inReview += 1;
      if (
        ["publish_failed", "changes_requested", "needs_metadata", "rejected"].includes(
          status
        )
      ) {
        accumulator.needsAttention += 1;
      }
      return accumulator;
    },
    { total: 0, published: 0, inReview: 0, needsAttention: 0 }
  );
}

function getProgressStageState(status, stageKey) {
  const normalized = normalizeSubmissionStatus(status);
  const stageIndex = progressStages.findIndex((item) => item.key === stageKey);
  const currentIndex = progressStages.findIndex((item) => item.key === normalized);

  if (["changes_requested", "needs_metadata", "rejected"].includes(normalized)) {
    if (stageKey === "submitted") return "complete";
    if (stageKey === "needs_human_review") return "current";
    return "pending";
  }

  if (normalized === "publish_failed") {
    if (stageKey === "submitted" || stageKey === "needs_human_review") {
      return "complete";
    }
    if (stageKey === "approved") return "current";
    return "pending";
  }

  if (stageIndex === currentIndex) return "current";
  if (stageIndex !== -1 && currentIndex !== -1 && stageIndex < currentIndex) {
    return "complete";
  }
  return "pending";
}

module.exports = {
  countStatuses,
  formatApiConnectionLabel,
  formatBackendConnectionCopy,
  formatStatusLabel,
  formatApprovalRoleLabel,
  isHostedDevApiBaseUrl,
  formatRoutingSourceLabel,
  getProgressStageState,
  getStatusTone,
  normalizeSubmissionStatus,
  progressStages,
  summarizeSubmissionProgress
};
