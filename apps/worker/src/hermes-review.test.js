import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeHermesResponsesApiResponse,
  normalizeHermesReviewResponse,
  normalizeOllamaGenerateResponse,
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

test("normalizes Hermes Responses API output text", () => {
  const result = normalizeHermesResponsesApiResponse({
    id: "resp-1",
    model: "general-coding",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              risk_level: "medium",
              confidence: 0.72,
              summary: "Needs a privacy check.",
              caption_draft: "Team update",
              review_required_reason: "Contact detail",
              findings: [
                {
                  type: "privacy",
                  severity: "medium",
                  message: "Contains contact info."
                }
              ]
            })
          }
        ]
      }
    ]
  });

  assert.equal(result.responseId, "resp-1");
  assert.equal(result.model, "general-coding");
  assert.equal(result.review.risk_level, "medium");
  assert.equal(result.review.caption_draft, "Team update");
  assert.equal(result.review.findings[0].type, "privacy");
});

test("normalizes Ollama generate review responses", () => {
  const result = normalizeOllamaGenerateResponse(
    {
      response: JSON.stringify({
        risk_level: "low",
        confidence: "medium",
        summary: "Safe team update.",
        caption_draft: "Great training session today.",
        findings: []
      })
    },
    "llama3.2:3b-instruct-q4_K_M"
  );

  assert.equal(result.model, "llama3.2:3b-instruct-q4_K_M");
  assert.equal(result.review.risk_level, "low");
  assert.equal(result.review.confidence, 0.65);
  assert.equal(result.review.caption_draft, "Great training session today.");
});

test("accepts fenced JSON from review providers", () => {
  const result = normalizeOllamaGenerateResponse({
    response:
      '```json\n{"risk_level":"medium","confidence":0.7,"summary":"Needs privacy check.","caption_draft":"Team update","findings":[]}\n```'
  });

  assert.equal(result.review.risk_level, "medium");
  assert.equal(result.review.summary, "Needs privacy check.");
});

test("surfaces non-JSON Hermes Responses API output", () => {
  assert.throws(
    () =>
      normalizeHermesResponsesApiResponse({
        output_text:
          "Error code: 402 - Prompt tokens limit exceeded: 27882 > 24585"
      }),
    /invalid review JSON: Error code: 402 - Prompt tokens limit exceeded/
  );
});

test("posts review prompts to Ollama generate mode", async () => {
  const calls = [];
  const result = await runHermesReviewAgent(
    {
      rawText: "Great goal from kickoff.",
      visibilityTarget: "internal",
      contentType: "photo",
      submitterName: "Coach"
    },
    {
      agentUrl: "http://ollama.local/api/generate",
      agentName: "qwen3:4b-instruct",
      agentMode: "ollama_generate",
      async fetchImpl(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async json() {
            return {
              response: JSON.stringify({
                risk_level: "low",
                confidence: 0.9,
                summary: "Safe for standard review.",
                caption_draft: "Great goal from kickoff.",
                findings: []
              })
            };
          }
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://ollama.local/api/generate");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "qwen3:4b-instruct");
  assert.equal(body.stream, false);
  assert.equal(body.format, "json");
  assert.equal(body.options.temperature, 0);
  assert.match(body.prompt, /Return only valid JSON/);
  assert.match(body.prompt, /Visibility target: internal/);
  assert.equal(result.review.risk_level, "low");
});

test("posts review prompts to Hermes Responses API mode", async () => {
  const calls = [];
  const result = await runHermesReviewAgent(
    {
      rawText: "Player shared a phone number after the match.",
      visibilityTarget: "public",
      contentType: "photo",
      submitterName: "Coach"
    },
    {
      agentUrl: "http://hermes.local/v1/responses",
      agentName: "general-coding",
      agentMode: "responses_api",
      apiKey: "secret",
      async fetchImpl(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async json() {
            return {
              id: "resp-1",
              model: "general-coding",
              output: [
                {
                  content: [
                    {
                      text: JSON.stringify({
                        risk_level: "high",
                        confidence: 0.91,
                        summary: "Contact detail requires review.",
                        caption_draft: "Player update",
                        review_required_reason: "Privacy risk",
                        findings: []
                      })
                    }
                  ]
                }
              ]
            };
          }
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://hermes.local/v1/responses");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "general-coding");
  assert.equal(body.store, false);
  assert.match(body.input, /Return only valid JSON/);
  assert.match(body.input, /Visibility target: public/);
  assert.match(body.input, /Submission text: Player shared a phone number/);
  assert.equal(result.review.risk_level, "high");
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
