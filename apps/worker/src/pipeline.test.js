import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewArtifacts } from "./pipeline.js";

test("builds review artifacts from Hermes when the agent is configured", async () => {
  const originalUrl = process.env.HERMES_REVIEW_AGENT_URL;
  const originalApiKey = process.env.HERMES_REVIEW_AGENT_API_KEY;
  const originalFetch = globalThis.fetch;
  const calls = [];

  process.env.HERMES_REVIEW_AGENT_URL = "https://hermes.example.test/review";
  process.env.HERMES_REVIEW_AGENT_API_KEY = "secret";
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          id: "run-1",
          model: "hermes-v1",
          review: {
            risk_level: "high",
            confidence: 0.88,
            summary: "Privacy-sensitive detail found.",
            caption_draft: "Updated caption",
            review_required_reason: "Privacy review",
            findings: [
              {
                type: "privacy",
                severity: "high",
                message: "Contains contact detail."
              }
            ]
          }
        };
      }
    };
  };

  try {
    const artifacts = await buildReviewArtifacts({
      raw_text: "Call me after the match.",
      visibility_target: "public",
      content_type: "photo",
      submitter_name: "Coach"
    });

    assert.equal(calls.length, 1);
    assert.equal(artifacts.mode, "hermes");
    assert.equal(artifacts.riskScore, 0.85);
    assert.equal(artifacts.summary, "Privacy-sensitive detail found.");
    assert.equal(artifacts.captionDraft, "Updated caption");
    assert.equal(artifacts.moderation.model, "hermes-v1");
    assert.equal(artifacts.moderation.flagged, true);
    assert.equal(artifacts.structured.responseId, "run-1");
    assert.equal(artifacts.findings[0].type, "privacy");
  } finally {
    if (originalUrl === undefined) {
      delete process.env.HERMES_REVIEW_AGENT_URL;
    } else {
      process.env.HERMES_REVIEW_AGENT_URL = originalUrl;
    }

    if (originalApiKey === undefined) {
      delete process.env.HERMES_REVIEW_AGENT_API_KEY;
    } else {
      process.env.HERMES_REVIEW_AGENT_API_KEY = originalApiKey;
    }

    globalThis.fetch = originalFetch;
  }
});
