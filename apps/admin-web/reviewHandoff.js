function formatRoleLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "reviewer";
  return normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function inferDestination(item) {
  if (item?.publishedPost?.destinationName) return item.publishedPost.destinationName;
  if (item?.destination_name) return item.destination_name;
  if (item?.visibility_target === "internal") return "Internal Club Feed";
  return "the selected destination";
}

export function summarizeReviewHandoff(item = {}) {
  const status = String(item.submission_status || item.status || "received").toLowerCase();
  const destination = inferDestination(item);
  const approver = formatRoleLabel(
    item.approverRole ||
      item.approver_role ||
      item.routing_decision?.approverRole ||
      item.routing_decision?.approver_role
  );

  if (status === "published") {
    return {
      label: "Handoff complete",
      title: `Live in ${destination}`,
      body: "The submitter can now share it or confirm it in the feed."
    };
  }

  if (status === "approved_internal") {
    return {
      label: "Publishing",
      title: `Approved for ${destination}`,
      body: "The workflow owns the publish step. Watch recovery if it does not land shortly."
    };
  }

  if (status === "publish_failed") {
    return {
      label: "Admin handoff",
      title: "Publishing needs recovery",
      body: "Use Workflow Recovery before the submitter tries again."
    };
  }

  if (status === "needs_metadata" || status === "changes_requested") {
    return {
      label: "Submitter handoff",
      title: "Needs an update from the submitter",
      body: "Send one clear note so the next version can re-enter review cleanly."
    };
  }

  if (status === "rejected") {
    return {
      label: "Review closed",
      title: "Stopped by reviewer",
      body: "This version should not publish. A new version needs a fresh submission."
    };
  }

  if (status === "needs_human_review") {
    return {
      label: "Reviewer handoff",
      title: `Waiting on ${approver}`,
      body: `The submitter is done for now. Approval sends this toward ${destination}.`
    };
  }

  return {
    label: "Workflow handoff",
    title: "Preparing for review",
    body: "The system is still building the review packet before a reviewer acts."
  };
}
