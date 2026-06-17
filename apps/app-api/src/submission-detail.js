export function buildSubmissionDetail({
  submission,
  latestReviewRun,
  latestApprovalRequest,
  publishedPost
}) {
  return {
    ...submission,
    latestReviewRun: latestReviewRun || null,
    latestApprovalRequest: latestApprovalRequest || null,
    publishedPost: publishedPost || null
  };
}
