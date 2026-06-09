const audienceProfiles = {
  parents: {
    label: "Parents",
    prefix: "Family update"
  },
  players: {
    label: "Players",
    prefix: "Player spotlight"
  },
  coaches: {
    label: "Coaches",
    prefix: "Coach note"
  },
  leadership: {
    label: "Leadership",
    prefix: "Club leadership brief"
  }
};

function normalizeCaption(value) {
  const caption = String(value || "").replace(/\s+/g, " ").trim();
  return caption || "Club update ready for review.";
}

export function buildAudienceReviewPackage({
  rawText,
  captionDraft,
  analysisSummary,
  riskScore,
  routingDecision
}) {
  const baseCaption = normalizeCaption(captionDraft || rawText);
  const audienceRewrites = Object.fromEntries(
    Object.entries(audienceProfiles).map(([key, profile]) => [
      key,
      {
        audience: profile.label,
        caption: `${profile.prefix}: ${baseCaption}`,
        basedOnCaptionDraft: Boolean(String(captionDraft || "").trim())
      }
    ])
  );

  return {
    analysisCore: {
      summary: analysisSummary || "Review completed.",
      riskScore: Number(riskScore || 0),
      route: routingDecision?.route || "human_review",
      approverRole: routingDecision?.approverRole || "club_comms"
    },
    audienceRewrites
  };
}
