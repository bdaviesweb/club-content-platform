function normalizeApiBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function shouldApplyReadinessDefault(currentValue, fallbackValue) {
  const current = String(currentValue || "").trim();
  return !current || current === fallbackValue;
}

function extractReadinessDefaults(payload) {
  const demo = payload?.demo || {};
  return {
    clubSlug: typeof demo.clubSlug === "string" ? demo.clubSlug.trim() : "",
    teamSlug: typeof demo.teamSlug === "string" ? demo.teamSlug.trim() : "",
    submitterEmail: typeof demo.submitterEmail === "string" ? demo.submitterEmail.trim() : "",
    reviewerEmail: typeof demo.reviewerEmail === "string" ? demo.reviewerEmail.trim() : ""
  };
}

async function fetchAppReadiness(apiBaseUrl, fetchImpl = fetch) {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (!baseUrl) {
    throw new Error("API base URL is required.");
  }

  const response = await fetchImpl(`${baseUrl}/app/readiness`);
  if (!response.ok) {
    throw new Error(`Backend readiness failed: ${response.status}`);
  }

  return response.json();
}

function summarizeAppReadiness(payload) {
  if (!payload) return "Not checked";

  const failedChecks = Array.isArray(payload.checks)
    ? payload.checks.filter((check) => !check.ok)
    : [];

  if (failedChecks.length) {
    return `${failedChecks.length} rule ${failedChecks.length === 1 ? "gap" : "gaps"}`;
  }

  return "Ready";
}

function formatCapability(value) {
  return value ? "Ready" : "Not ready";
}

module.exports = {
  extractReadinessDefaults,
  fetchAppReadiness,
  formatCapability,
  shouldApplyReadinessDefault,
  summarizeAppReadiness
};
