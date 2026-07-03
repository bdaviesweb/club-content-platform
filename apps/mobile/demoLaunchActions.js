const demoLaunchActions = {
  loadWorkspace: "load-workspace",
  createPost: "create-post",
  openReview: "open-review",
  openFirstReview: "open-first-review",
  approveFirstReview: "approve-first-review"
};

function parseDemoLaunchRequest(url) {
  if (!url) return null;

  let parsedUrl;
  let pathname = "";

  try {
    parsedUrl = new URL(String(url));
    pathname = parsedUrl.pathname || "";
  } catch {
    return null;
  }

  const queryAction = parsedUrl.searchParams.get("demoAction");
  const submissionId =
    parsedUrl.searchParams.get("submissionId") ||
    parsedUrl.searchParams.get("targetSubmissionId") ||
    null;

  const buildRequest = (action) => ({ action, submissionId });

  if (queryAction === "load") return buildRequest(demoLaunchActions.loadWorkspace);
  if (queryAction === "post") return buildRequest(demoLaunchActions.createPost);
  if (queryAction === "review") return buildRequest(demoLaunchActions.openReview);
  if (queryAction === "reviewFirst") {
    return buildRequest(demoLaunchActions.openFirstReview);
  }
  if (queryAction === "approveFirstReview") {
    return buildRequest(demoLaunchActions.approveFirstReview);
  }

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "--");

  if (segments[0] !== "demo") return null;
  if (segments[1] === "load") return buildRequest(demoLaunchActions.loadWorkspace);
  if (segments[1] === "post") return buildRequest(demoLaunchActions.createPost);
  if (segments[1] === "review") return buildRequest(demoLaunchActions.openReview);
  if (segments[1] === "review-first") {
    return buildRequest(demoLaunchActions.openFirstReview);
  }
  if (segments[1] === "approve-first-review") {
    return buildRequest(demoLaunchActions.approveFirstReview);
  }
  return null;
}

function parseDemoLaunchAction(url) {
  return parseDemoLaunchRequest(url)?.action || null;
}

function selectDemoReviewQueueItem(items = [], targetSubmissionId = null) {
  if (!targetSubmissionId) {
    return items[0] || null;
  }

  const targetedItem =
    items.find((item) => item?.submission_id === targetSubmissionId) || null;
  if (!targetedItem) {
    throw new Error(
      `Targeted demo review item was not found: ${targetSubmissionId}`
    );
  }

  return targetedItem;
}

module.exports = {
  demoLaunchActions,
  parseDemoLaunchAction,
  parseDemoLaunchRequest,
  selectDemoReviewQueueItem
};
