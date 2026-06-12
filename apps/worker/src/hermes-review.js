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

function getDefaultAgentMode() {
  return process.env.HERMES_REVIEW_AGENT_MODE || "review_agent";
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

function buildReviewPrompt({
  rawText,
  visibilityTarget,
  contentType,
  submitterName
}) {
  return [
    "You review youth sports club content submissions.",
    "Return only valid JSON.",
    "Decide whether this submission is low, medium, or high risk for a club content workflow involving minors.",
    "Provide a concise internal caption draft suitable for a club feed.",
    "If the text contains sensitive injury, medical, bullying, harassment, profanity, contact details, or privacy issues, call that out.",
    "Use this JSON shape exactly:",
    '{"risk_level":"low|medium|high","confidence":0.0,"summary":"...","caption_draft":"...","review_required_reason":"...","findings":[{"type":"policy|privacy|quality|safety","severity":"low|medium|high","message":"..."}]}',
    "",
    `Visibility target: ${visibilityTarget || "internal"}`,
    `Content type: ${contentType || "unknown"}`,
    `Submitter name: ${submitterName || "Contributor"}`,
    `Submission text: ${rawText || "(none provided)"}`
  ].join("\n");
}

function extractResponsesOutputText(payload = {}) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((content) => content?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function summarizeOutputText(value) {
  return normalizeOptionalString(value).replace(/\s+/g, " ").slice(0, 220);
}

export function normalizeHermesResponsesApiResponse(payload = {}) {
  const outputText = extractResponsesOutputText(payload);
  if (!outputText) {
    throw new Error("Hermes Responses API returned no output text");
  }

  let review;
  try {
    review = JSON.parse(outputText);
  } catch (error) {
    throw new Error(
      `Hermes Responses API returned invalid review JSON: ${summarizeOutputText(outputText)}`
    );
  }

  return normalizeHermesReviewResponse({
    id: payload.id,
    model: payload.model,
    review,
    raw: payload
  });
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
    agentMode = getDefaultAgentMode(),
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

  if (normalizeOptionalString(agentMode).toLowerCase() === "responses_api") {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: agentName,
        input: buildReviewPrompt({
          rawText,
          visibilityTarget,
          contentType,
          submitterName
        }),
        store: false
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hermes Responses API review failed: ${response.status} ${text}`);
    }

    return normalizeHermesResponsesApiResponse(await response.json());
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
