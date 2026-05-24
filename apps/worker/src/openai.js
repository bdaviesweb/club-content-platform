const defaultApiBase = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
const moderationModel =
  process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";
const reviewModel = process.env.OPENAI_REVIEW_MODEL || "gpt-5-mini";

function requireApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return apiKey;
}

async function postJson(path, body) {
  const response = await fetch(`${defaultApiBase}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requireApiKey()}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${path} failed: ${response.status} ${text}`);
  }

  return response.json();
}

export function hasOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  return Boolean(apiKey && apiKey !== "replace-me");
}

export async function runModeration(rawText) {
  const moderation = await postJson("/moderations", {
    model: moderationModel,
    input: rawText || ""
  });

  const result = moderation.results?.[0] || {};
  return {
    model: moderation.model || moderationModel,
    flagged: Boolean(result.flagged),
    categories: result.categories || {},
    categoryScores: result.category_scores || {}
  };
}

export async function runStructuredReview({
  rawText,
  visibilityTarget,
  contentType
}) {
  const prompt = [
    "You review youth sports club content submissions.",
    "Return only valid JSON.",
    "Decide whether this submission is low, medium, or high risk for a club content workflow involving minors.",
    "Provide a concise internal caption draft suitable for a club feed.",
    "If the text contains sensitive injury, medical, bullying, harassment, profanity, contact details, or privacy issues, call that out.",
    "Use this JSON shape exactly:",
    '{"risk_level":"low|medium|high","confidence":0.0,"summary":"...","caption_draft":"...","review_required_reason":"...","findings":[{"type":"policy|privacy|quality|safety","severity":"low|medium|high","message":"..."}]}',
    "",
    `Visibility target: ${visibilityTarget}`,
    `Content type: ${contentType}`,
    `Submission text: ${rawText || "(none provided)"}`
  ].join("\n");

  const response = await postJson("/responses", {
    model: reviewModel,
    input: prompt,
    text: {
      format: {
        type: "json_object"
      }
    }
  });

  if (!response.output_text) {
    throw new Error("Responses API returned no output_text");
  }

  return {
    model: response.model || reviewModel,
    responseId: response.id,
    review: JSON.parse(response.output_text)
  };
}
