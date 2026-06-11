function getDefaultAgentUrl() {
  return process.env.HERMES_REVIEW_AGENT_URL || "";
}

function getDefaultAgentName() {
  return process.env.HERMES_REVIEW_AGENT_NAME || "club-content-review-agent";
}

function getDefaultAgentModel() {
  return process.env.HERMES_REVIEW_AGENT_MODEL || "hermes-review-agent";
}

function getDefaultAgentVersion() {
  return process.env.HERMES_REVIEW_AGENT_VERSION || "0.1.0";
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeRiskLevel(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (["low", "medium", "high"].includes(normalized)) {
    return normalized;
  }

  return "medium";
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0.75;
  }

  return Math.max(0, Math.min(number, 1));
}

function normalizeFindings(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((finding) => ({
    type: normalizeOptionalString(finding?.type) || "policy",
    severity: normalizeRiskLevel(finding?.severity),
    message:
      normalizeOptionalString(finding?.message) ||
      "Hermes review flagged this submission."
  }));
}

export function hasHermesReviewAgent() {
  return Boolean(normalizeOptionalString(getDefaultAgentUrl()));
}

export function normalizeHermesReviewResponse(payload = {}) {
  const review = payload.review || payload.output || payload;

  return {
    model: payload.model || getDefaultAgentModel(),
    responseId: payload.id || payload.runId || null,
    review: {
      risk_level: normalizeRiskLevel(review.risk_level || review.riskLevel),
      confidence: normalizeConfidence(review.confidence),
      summary:
        normalizeOptionalString(review.summary) ||
        "Hermes review completed.",
      caption_draft:
        normalizeOptionalString(review.caption_draft || review.captionDraft) ||
        "",
      review_required_reason:
        normalizeOptionalString(
          review.review_required_reason || review.reviewRequiredReason
        ) || null,
      findings: normalizeFindings(review.findings)
    },
    raw: payload
  };
}

export async function runHermesReviewAgent(
  { rawText, visibilityTarget, contentType, submitterName },
  {
    agentUrl = getDefaultAgentUrl(),
    agentName = getDefaultAgentName(),
    agentVersion = getDefaultAgentVersion(),
    apiKey = process.env.HERMES_REVIEW_AGENT_API_KEY || "",
    fetchImpl = fetch
  } = {}
) {
  const endpoint = normalizeOptionalString(agentUrl);
  if (!endpoint) {
    throw new Error("HERMES_REVIEW_AGENT_URL is not configured");
  }

  const headers = {
    "content-type": "application/json"
  };

  if (normalizeOptionalString(apiKey)) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      agent: agentName,
      version: agentVersion,
      input: {
        rawText: rawText || "",
        visibilityTarget,
        contentType,
        submitterName
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hermes review agent failed: ${response.status} ${text}`);
  }

  return normalizeHermesReviewResponse(await response.json());
}
