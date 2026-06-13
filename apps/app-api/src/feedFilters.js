const smokeRawTextPrefixes = [
  "approval-publish-smoke-",
  "hermes-smoke-",
  "hermes-diagnostic-",
  "E2E smoke post",
  "Approval action smoke"
];

export function isSmokeRawText(value) {
  const rawText = String(value || "");
  return smokeRawTextPrefixes.some((prefix) => rawText.startsWith(prefix));
}

export function buildInternalFeedSmokeFilter(includeSmoke) {
  if (includeSmoke) {
    return {
      clause: "",
      values: []
    };
  }

  return {
    clause: `
      AND NOT (${smokeRawTextPrefixes
        .map((_, index) => `s.raw_text LIKE $${index + 1}`)
        .join(" OR ")})
    `,
    values: smokeRawTextPrefixes.map((prefix) => `${prefix}%`)
  };
}

export { smokeRawTextPrefixes };
