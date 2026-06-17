export function buildPublishFailureSummary(error) {
  const message = error?.message || "Unknown publishing failure";
  return `Publishing failed: ${message}`;
}

export function buildPublishFailureEventPayload(error) {
  return {
    error: error?.message || "Unknown publishing failure"
  };
}

export function buildPublishedEventPayload(result = {}) {
  return {
    destinationType: result.destinationType || null,
    destinationName: result.destinationName || null
  };
}

export function buildPublishedNotificationPayload({ submissionId, result = {} }) {
  return {
    submissionId,
    status: "published",
    destinationType: result.destinationType || null,
    destinationName: result.destinationName || null
  };
}
