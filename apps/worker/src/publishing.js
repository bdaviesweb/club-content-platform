import { internalDestinationType } from "../../../packages/shared/src/index.js";

function normalizeDestinationConfig(config) {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config;
  }

  return {};
}

function normalizePublishResult(destination, result = {}) {
  const destinationType = destination.destination_type || destination.destinationType;
  return {
    destinationType,
    destinationName: destination.name || destinationType,
    externalPostId:
      result.externalPostId ||
      result.external_post_id ||
      `${destinationType}:${result.submissionId || "unknown"}`,
    externalReference: result.externalReference || result.external_reference || null,
    resultSummary:
      result.resultSummary ||
      result.result_summary ||
      `Published to ${destination.name || destinationType}`
  };
}

const adapters = {
  [internalDestinationType]: {
    async publish({ submission, destination }) {
      return normalizePublishResult(destination, {
        submissionId: submission.id,
        externalPostId: `internal:${submission.id}`,
        externalReference: `internal:${submission.id}`,
        resultSummary: "Published to internal feed by worker"
      });
    }
  }
};

export function getPublishingAdapter(destinationType) {
  const adapter = adapters[destinationType];
  if (!adapter) {
    throw new Error(`Publishing adapter not configured for ${destinationType}`);
  }

  return adapter;
}

export async function publishToDestination({ submission, destination }) {
  const destinationType = destination?.destination_type || destination?.destinationType;
  if (!destinationType) {
    throw new Error("Publishing destination is missing a destination type");
  }

  const adapter = getPublishingAdapter(destinationType);
  return adapter.publish({
    submission,
    destination: {
      ...destination,
      destination_type: destinationType,
      config: normalizeDestinationConfig(destination.config)
    }
  });
}
