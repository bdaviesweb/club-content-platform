import { reviewThresholds } from "../../../packages/shared/src/index.js";

const defaultPolicy = {
  channels: [
    { key: "instagram", label: "Instagram", favorite: true, allowed: true },
    { key: "facebook", label: "Facebook", favorite: true, allowed: true },
    { key: "team-feed", label: "Team Feed", favorite: true, allowed: true },
    { key: "website", label: "Website", favorite: false, allowed: true },
    { key: "newsletter", label: "Newsletter", favorite: false, allowed: true },
    { key: "x", label: "X", favorite: false, allowed: false, reviewRequired: true },
    { key: "tiktok", label: "TikTok", favorite: false, allowed: false, reviewRequired: true }
  ],
  routing: {
    publishMainFeedByDefault: true
  },
  review: {
    autoApproveMaxRisk: 0.2,
    alwaysReviewChannels: ["X", "TikTok"],
    alwaysReviewKeywords: [
      "injury",
      "hospital",
      "concussion",
      "address",
      "phone",
      "email",
      "contact"
    ],
    alwaysReviewContentTypes: ["video"]
  }
};

export const DEFAULT_CLUB_POLICY = defaultPolicy;

const channelAliases = new Map([
  ["club instagram", "instagram"],
  ["club facebook", "facebook"],
  ["team page", "team-feed"],
  ["club instagram favorite", "instagram"],
  ["club facebook favorite", "facebook"],
  ["team page favorite", "team-feed"]
]);

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalChannelKey(value) {
  const normalized = normalizeText(value);
  return channelAliases.get(normalized) || normalized.replace(/\s+/g, "-");
}

function parseSubmissionField(rawText, label) {
  const value = String(rawText || "");
  const escapedLabel = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

export function mergeClubPolicy(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    ...defaultPolicy,
    ...config,
    routing: {
      ...defaultPolicy.routing,
      ...(config.routing || {})
    },
    review: {
      ...defaultPolicy.review,
      ...(config.review || {})
    },
    channels: Array.isArray(config.channels) ? config.channels : defaultPolicy.channels
  };
}

function parseSubmissionChannels(submission) {
  if (Array.isArray(submission?.selected_channels)) {
    return submission.selected_channels
      .map((channel) => String(channel || "").trim())
      .filter(Boolean);
  }

  return parseSubmissionField(submission?.raw_text || "", "Channels")
    .split(",")
    .map((channel) => channel.trim())
    .filter(Boolean);
}

export async function loadClubPolicy(client, clubId) {
  try {
    const tableExistsResult = await client.query(
      `
      SELECT to_regclass('public.club_workflow_policies') AS policy_table
      `
    );

    if (!tableExistsResult.rows[0]?.policy_table) {
      return mergeClubPolicy(DEFAULT_CLUB_POLICY);
    }

    const result = await client.query(
      `
      SELECT config
      FROM club_workflow_policies
      WHERE club_id = $1
      LIMIT 1
      `,
      [clubId]
    );

    return mergeClubPolicy(result.rows[0]?.config);
  } catch (error) {
    if (error?.code !== "42P01") {
      throw error;
    }
    return mergeClubPolicy(DEFAULT_CLUB_POLICY);
  }
}

export function evaluateClubRouting(submission, reviewArtifacts, policy) {
  const policyConfig = mergeClubPolicy(policy);
  const rawText = String(submission.raw_text || "");
  const parsedChannels = parseSubmissionChannels(submission);
  const normalizedKeywords = normalizeText(rawText);
  const policyChannels = policyConfig.channels || [];
  const channelLookup = new Map(
    policyChannels.map((channel) => [canonicalChannelKey(channel.label || channel.key), channel])
  );

  const matchedChannels = parsedChannels.map((channelName) => {
    const normalized = canonicalChannelKey(channelName);
    return channelLookup.get(normalized) || {
      label: channelName,
      key: normalized,
      favorite: false,
      allowed: true
    };
  });

  const channelPolicyHits = matchedChannels
    .filter((channel) => {
      const channelName = normalizeText(channel.label || channel.key);
      const alwaysReviewChannels = (policyConfig.review.alwaysReviewChannels || []).map((value) =>
        normalizeText(value)
      );
      return (
        channel.reviewRequired ||
        channel.allowed === false ||
        alwaysReviewChannels.includes(channelName)
      );
    })
    .map((channel) => channel.label || channel.key);

  const keywordPolicyHits = (policyConfig.review.alwaysReviewKeywords || []).filter((keyword) =>
    normalizedKeywords.includes(normalizeText(keyword))
  );

  const contentTypeHit = (policyConfig.review.alwaysReviewContentTypes || []).includes(
    String(submission.content_type || "").toLowerCase()
  );

  const riskScore = Number(reviewArtifacts.riskScore || 0);
  const riskThreshold = Number(policyConfig.review.autoApproveMaxRisk ?? 0.2);
  const shouldAutoApprove =
    riskScore <= riskThreshold &&
    channelPolicyHits.length === 0 &&
    keywordPolicyHits.length === 0 &&
    !contentTypeHit &&
    Number(reviewArtifacts.riskScore || 0) < reviewThresholds.mediumRisk;

  const approverRole =
    submission.visibility_target === "public" || riskScore >= reviewThresholds.mediumRisk
      ? "club_comms"
      : "team_manager";

  const reasons = [];

  if (channelPolicyHits.length) {
    reasons.push(`Channels require review: ${channelPolicyHits.join(", ")}`);
  }
  if (keywordPolicyHits.length) {
    reasons.push(`Policy keywords found: ${keywordPolicyHits.join(", ")}`);
  }
  if (contentTypeHit) {
    reasons.push("Video content stays in review by default.");
  }
  if (!reasons.length && shouldAutoApprove) {
    reasons.push("Low-risk content matched workspace policy for direct approval.");
  }

  return {
    route: shouldAutoApprove ? "auto_approve" : "human_review",
    approverRole,
    rationale: reviewArtifacts.summary,
    publishMainFeedByDefault: policyConfig.routing?.publishMainFeedByDefault !== false,
    policyHits: {
      channels: channelPolicyHits,
      keywords: keywordPolicyHits,
      contentType: contentTypeHit ? [String(submission.content_type || "")] : []
    },
    recommendedChannels: matchedChannels.filter((channel) => channel.allowed !== false),
    blockedChannels: matchedChannels.filter((channel) => channel.allowed === false),
    reasons
  };
}
