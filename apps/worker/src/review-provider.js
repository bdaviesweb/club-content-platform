import { reviewThresholds } from "../../../packages/shared/src/index.js";
import { draftCaption, scoreRisk, summarizeReview } from "./fallback-review.js";
import { hasHermesReviewAgent, runHermesReviewAgent } from "./hermes-review.js";
import { hasOpenAI, runModeration, runStructuredReview } from "./openai.js";

function riskLevelToScore(riskLevel) {
  switch (riskLevel) {
    case "high":
      return 0.85;
    case "medium":
      return 0.55;
    default:
      return 0.15;
  }
}

function buildReviewFallbackReason(provider, error) {
  const message = error?.message || "unknown error";
  return `${provider} review unavailable: ${message}`;
}

function normalizeReviewProviderMode(value = process.env.REVIEW_PROVIDER_MODE || "auto") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (
    [
      "auto",
      "disabled",
      "log_only",
      "fallback_only",
      "hermes_only",
      "openai_only"
    ].includes(normalized)
  ) {
    return normalized;
  }

  return "auto";
}

function buildFallbackArtifacts(submission, mode = "fallback") {
  const fallbackRiskScore = scoreRisk(submission.raw_text || "");
  return {
    mode,
    riskScore: fallbackRiskScore,
    summary: summarizeReview(submission.raw_text || "", fallbackRiskScore),
    captionDraft: draftCaption(submission.raw_text || "", submission.submitter_name),
    moderation: {
      model: "local-rules",
      flagged: fallbackRiskScore >= reviewThresholds.highRisk,
      categories: {},
      categoryScores: {}
    },
    structured: null,
    findings:
      fallbackRiskScore >= reviewThresholds.mediumRisk
        ? [
            {
              type: "policy",
              severity: fallbackRiskScore >= reviewThresholds.highRisk ? "high" : "medium",
              message: "Fallback rules found language or details that require review."
            }
          ]
        : []
  };
}

async function buildOpenAIArtifacts(submission, summaryPrefix = "") {
  try {
    const moderation = await runModeration(submission.raw_text || "");
    const structured = await runStructuredReview({
      rawText: submission.raw_text || "",
      visibilityTarget: submission.visibility_target,
      contentType: submission.content_type
    });
    const review = structured.review || {};
    const riskScore = moderation.flagged
      ? Math.max(riskLevelToScore(review.risk_level), 0.8)
      : riskLevelToScore(review.risk_level);

    return {
      mode: "openai",
      riskScore,
      summary: `${summaryPrefix}${review.summary || "AI review completed."}`,
      captionDraft:
        review.caption_draft ||
        draftCaption(submission.raw_text || "", submission.submitter_name),
      moderation,
      structured,
      findings: Array.isArray(review.findings) ? review.findings : []
    };
  } catch (error) {
    const fallback = buildFallbackArtifacts(submission);
    const fallbackReason = buildReviewFallbackReason("OpenAI", error);
    return {
      ...fallback,
      fallbackReason,
      summary: `${fallback.summary} ${summaryPrefix}${fallbackReason}; local fallback used.`
    };
  }
}

async function buildHermesArtifacts(submission) {
  const structured = await runHermesReviewAgent({
    rawText: submission.raw_text || "",
    visibilityTarget: submission.visibility_target,
    contentType: submission.content_type,
    submitterName: submission.submitter_name
  });
  const review = structured.review || {};
  const riskScore = riskLevelToScore(review.risk_level);

  return {
    mode: "hermes",
    riskScore,
    summary: review.summary || "Hermes review completed.",
    captionDraft:
      review.caption_draft ||
      draftCaption(submission.raw_text || "", submission.submitter_name),
    moderation: {
      model: structured.model,
      flagged: riskScore >= reviewThresholds.highRisk,
      categories: {},
      categoryScores: {}
    },
    structured,
    findings: Array.isArray(review.findings) ? review.findings : []
  };
}

export function getReviewProviderMode() {
  return normalizeReviewProviderMode();
}

export async function buildReviewArtifacts(submission, { logger = console } = {}) {
  const mode = normalizeReviewProviderMode();

  if (mode === "disabled" || mode === "fallback_only") {
    const fallback = buildFallbackArtifacts(submission, mode);
    const message =
      mode === "disabled"
        ? "Review provider disabled; local fallback used."
        : "Review provider fallback-only mode; local fallback used.";

    logger.info?.(message, {
      mode,
      submissionId: submission.id || null
    });

    return {
      ...fallback,
      fallbackReason: message,
      summary: `${fallback.summary} ${message}`
    };
  }

  if (mode === "log_only") {
    const fallback = buildFallbackArtifacts(submission, mode);
    const message = "Review provider log-only mode; external review skipped and local fallback used.";

    logger.info?.(message, {
      mode,
      hermesConfigured: hasHermesReviewAgent(),
      openaiConfigured: hasOpenAI(),
      submissionId: submission.id || null
    });

    return {
      ...fallback,
      fallbackReason: message,
      summary: `${fallback.summary} ${message}`
    };
  }

  if (mode === "openai_only") {
    if (!hasOpenAI()) {
      const fallback = buildFallbackArtifacts(submission, mode);
      const fallbackReason = "OpenAI review unavailable: OPENAI_API_KEY is not configured";
      return {
        ...fallback,
        fallbackReason,
        summary: `${fallback.summary} ${fallbackReason}; local fallback used.`
      };
    }

    return buildOpenAIArtifacts(submission);
  }

  if (mode === "hermes_only") {
    try {
      return await buildHermesArtifacts(submission);
    } catch (error) {
      const fallback = buildFallbackArtifacts(submission, mode);
      const fallbackReason = buildReviewFallbackReason("Hermes", error);
      return {
        ...fallback,
        fallbackReason,
        summary: `${fallback.summary} ${fallbackReason}; local fallback used.`
      };
    }
  }

  if (hasHermesReviewAgent()) {
    try {
      return await buildHermesArtifacts(submission);
    } catch (error) {
      const fallbackReason = buildReviewFallbackReason("Hermes", error);
      if (hasOpenAI()) {
        return buildOpenAIArtifacts(submission, `${fallbackReason}; `);
      }

      const fallback = buildFallbackArtifacts(submission);
      return {
        ...fallback,
        fallbackReason,
        summary: `${fallback.summary} ${fallbackReason}; local fallback used.`
      };
    }
  }

  if (!hasOpenAI()) {
    return buildFallbackArtifacts(submission);
  }

  return buildOpenAIArtifacts(submission);
}
