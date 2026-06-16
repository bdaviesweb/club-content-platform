export function formatRoutingSourceLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "Local rules";
  }

  if (normalized === "hermes_agent") {
    return "Hermes";
  }

  if (normalized === "local_rules") {
    return "Local rules";
  }

  return normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
