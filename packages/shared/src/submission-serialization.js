export function buildSubmissionText(
  caption,
  tagsInput,
  selectedChannels,
  eventTypeInput,
  eventDetailInput,
  opponentInput,
  scoreInput,
  locationInput
) {
  const sections = [];
  const trimmedCaption = String(caption || "").trim();
  const tags = String(tagsInput || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const channelLabels = Array.isArray(selectedChannels)
    ? selectedChannels.map((channel) => String(channel || "").trim()).filter(Boolean)
    : [];
  const eventType = String(eventTypeInput || "").trim();
  const eventDetail = String(eventDetailInput || "").trim();
  const structuredPairs = [
    ["Opponent", opponentInput],
    ["Score", scoreInput],
    ["Location", locationInput]
  ];

  if (trimmedCaption) sections.push(trimmedCaption);
  if (tags.length) sections.push(`Tags: ${tags.join(", ")}`);
  if (channelLabels.length) sections.push(`Channels: ${channelLabels.join(", ")}`);
  if (eventType === "Other" && eventDetail) {
    sections.push(`Event: Other - ${eventDetail}`);
  } else if (eventType) {
    sections.push(`Event: ${eventType}`);
  }

  structuredPairs.forEach(([label, value]) => {
    const trimmedValue = String(value || "").trim();
    if (trimmedValue) sections.push(`${label}: ${trimmedValue}`);
  });

  return sections.join("\n");
}

export function buildSubmissionRequestBody({
  clubSlug,
  teamSlug,
  submitterEmail,
  contentType,
  rawText,
  selectedChannels,
  visibilityTarget,
  objectKey,
  mimeType
}) {
  const normalizedContentType = String(contentType || "").toLowerCase() === "video" ? "video" : "photo";
  const normalizedSelectedChannels = Array.isArray(selectedChannels)
    ? selectedChannels.map((channel) => String(channel || "").trim()).filter(Boolean)
    : [];

  return {
    clubSlug,
    teamSlug,
    submitterEmail,
    contentType: normalizedContentType,
    rawText,
    selectedChannels: normalizedSelectedChannels,
    visibilityTarget,
    media: [
      {
        objectKey,
        mediaType: normalizedContentType === "video" ? "video" : "image",
        mimeType: mimeType || "application/octet-stream"
      }
    ]
  };
}
