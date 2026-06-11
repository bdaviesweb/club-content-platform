import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeHermesReviewResponse,
  runHermesReviewAgent
} from "./hermes-review.js";

test("normalizes Hermes review responses", () => {
  const result = normalizeHermesReviewResponse({
    id: "run-1",
    model: "hermes-v1",
    review: {
      riskLevel: "HIGH",
      confidence: 2,
      summary: "Sensitive detail needs review.",
      captionDraft: "Clean caption",
      reviewRequiredReason: "Privacy risk",
      findings: [
        {
          type: "privacy",
          severity: "high",
          message: "Contains a contact detail."
        }
      ]
    }
  });

  assert.equal(result.responseId, "run-1");
  assert.equal(result.model, "hermes-v1");
  assert.deepEqual(result.review, {
    risk_level: "high",
    confidence: 1,
    summary: "Sensitive detail needs review.",
    caption_draft: "Clean caption",
    review_required_reason: "Privacy risk",
    findings: [
      {
        type: "privacy",
        severity: "high",
        message: "Contains a contact detail."
      }
    ]
  });
});

test("posts the submission to the configured Hermes review agent", async () => {
  const calls = [];
  const result = await runHermesReviewAgent(
    {
      rawText: "Great goal from kickoff.",
      visibilityTarget: "internal",
      contentType: "photo",
      submitterName: "Coach"
    },
    {
      agentUrl: "https://hermes.example.test/review",
      agentName: "club-content-review-agent",
      agentVersion: "2026-06-11",
      apiKey: "secret",
      async fetchImpl(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async json() {
            return {
              output: {
                risk_level: "low",
                confidence: 0.9,
                summary: "Safe for standard review.",
                caption_draft: "Great goal from kickoff."
              }
            };
          }
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hermes.example.test/review");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    agent: "club-content-review-agent",
    version: "2026-06-11",
    input: {
      rawText: "Great goal from kickoff.",
      visibilityTarget: "internal",
      contentType: "photo",
      submitterName: "Coach"
    }
  });
  assert.equal(result.review.risk_level, "low");
  assert.equal(result.review.caption_draft, "Great goal from kickoff.");
});

test("surfaces Hermes agent HTTP failures", async () => {
  await assert.rejects(
    runHermesReviewAgent(
      { rawText: "test" },
      {
        agentUrl: "https://hermes.example.test/review",
        async fetchImpl() {
          return {
            ok: false,
            status: 502,
            async text() {
              return "bad gateway";
            }
          };
        }
      }
    ),
    /Hermes review agent failed: 502 bad gateway/
  );
});
