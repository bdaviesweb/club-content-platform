const demoLaunchActions = {
  loadWorkspace: "load-workspace",
  createPost: "create-post",
  openReview: "open-review"
};

function parseDemoLaunchAction(url) {
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
  if (queryAction === "load") return demoLaunchActions.loadWorkspace;
  if (queryAction === "post") return demoLaunchActions.createPost;
  if (queryAction === "review") return demoLaunchActions.openReview;

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "--");

  if (segments[0] !== "demo") return null;
  if (segments[1] === "load") return demoLaunchActions.loadWorkspace;
  if (segments[1] === "post") return demoLaunchActions.createPost;
  if (segments[1] === "review") return demoLaunchActions.openReview;
  return null;
}

module.exports = {
  demoLaunchActions,
  parseDemoLaunchAction
};
