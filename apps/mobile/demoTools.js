const demoSubmissionPrefix = "mobile-demo-post";

function buildDemoSubmissionText(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const timestamp = Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();

  return `${demoSubmissionPrefix}-${timestamp}`;
}

function buildDemoSubmissionPayload({
  clubSlug,
  teamSlug,
  submitterEmail,
  visibilityTarget = "internal",
  now
} = {}) {
  return {
    clubSlug,
    teamSlug,
    submitterEmail,
    contentType: "photo",
    rawText: buildDemoSubmissionText(now),
    visibilityTarget,
    media: []
  };
}

module.exports = {
  buildDemoSubmissionPayload,
  buildDemoSubmissionText,
  demoSubmissionPrefix
};
