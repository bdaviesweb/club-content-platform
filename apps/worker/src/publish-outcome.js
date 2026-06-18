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
  const results = Array.isArray(result.results) ? result.results : null;
  const primary = results?.[0] || result;

  return {
    policySource: result.policySource || null,
    destinationType: primary.destinationType || null,
    destinationName: primary.destinationName || null,
    destinationCount: results?.length || 1,
    destinations: results
      ? results.map((entry) => ({
          destinationType: entry.destinationType || null,
          destinationName: entry.destinationName || null
        }))
      : [
          {
            destinationType: primary.destinationType || null,
            destinationName: primary.destinationName || null
          }
        ]
  };
}

export function buildPublishedNotificationPayload({ submissionId, result = {} }) {
  const results = Array.isArray(result.results) ? result.results : null;
  const primary = results?.[0] || result;

  return {
    submissionId,
    status: "published",
    policySource: result.policySource || null,
    destinationType: primary.destinationType || null,
    destinationName: primary.destinationName || null,
    destinationCount: results?.length || 1,
    destinations: results
      ? results.map((entry) => ({
          destinationType: entry.destinationType || null,
          destinationName: entry.destinationName || null
        }))
      : [
          {
            destinationType: primary.destinationType || null,
            destinationName: primary.destinationName || null
          }
        ]
  };
}
