import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewArtifacts, getReviewProviderMode } from "./review-provider.js";

function restoreEnv(name, originalValue) {
  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = originalValue;
}

test("normalizes unknown review provider modes back to auto", () => {
  const originalMode = process.env.REVIEW_PROVIDER_MODE;
  process.env.REVIEW_PROVIDER_MODE = " something-else ";

  try {
    assert.equal(getReviewProviderMode(), "auto");
  } finally {
    restoreEnv("REVIEW_PROVIDER_MODE", originalMode);
  }
});

test("uses local fallback when review providers are disabled", async () => {
  const originalMode = process.env.REVIEW_PROVIDER_MODE;
  const messages = [];

  process.env.REVIEW_PROVIDER_MODE = "disabled";

  try {
    const artifacts = await buildReviewArtifacts(
      {
        id: "submission-disabled",
        raw_text: "Team update after practice.",
        visibility_target: "internal",
        content_type: "photo",
        submitter_name: "Coach"
      },
      {
        logger: {
          info(message, meta) {
            messages.push({ message, meta });
          }
        }
      }
    );

    assert.equal(artifacts.mode, "disabled");
    assert.equal(artifacts.moderation.model, "local-rules");
    assert.match(artifacts.summary, /Review provider disabled/);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].meta.mode, "disabled");
  } finally {
    restoreEnv("REVIEW_PROVIDER_MODE", originalMode);
  }
});

test("skips external review calls in log-only mode", async () => {
  const originalMode = process.env.REVIEW_PROVIDER_MODE;
  const originalHermesUrl = process.env.HERMES_REVIEW_AGENT_URL;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  process.env.REVIEW_PROVIDER_MODE = "log_only";
  process.env.HERMES_REVIEW_AGENT_URL = "https://hermes.example.test/review";
  process.env.OPENAI_API_KEY = "secret";
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };

  try {
    const artifacts = await buildReviewArtifacts({
      id: "submission-log-only",
      raw_text: "Goal recap for tonight.",
      visibility_target: "internal",
      content_type: "photo",
      submitter_name: "Coach"
    });

    assert.equal(artifacts.mode, "log_only");
    assert.match(artifacts.summary, /log-only mode/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("REVIEW_PROVIDER_MODE", originalMode);
    restoreEnv("HERMES_REVIEW_AGENT_URL", originalHermesUrl);
    restoreEnv("OPENAI_API_KEY", originalOpenAIKey);
  }
});

test("does not fall through to OpenAI in hermes-only mode", async () => {
  const originalMode = process.env.REVIEW_PROVIDER_MODE;
  const originalHermesUrl = process.env.HERMES_REVIEW_AGENT_URL;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  process.env.REVIEW_PROVIDER_MODE = "hermes_only";
  process.env.HERMES_REVIEW_AGENT_URL = "https://hermes.example.test/review";
  process.env.OPENAI_API_KEY = "secret";
  globalThis.fetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 502,
      async text() {
        return "bad gateway";
      }
    };
  };

  try {
    const artifacts = await buildReviewArtifacts({
      id: "submission-hermes-only",
      raw_text: "Player needs ice after the match.",
      visibility_target: "public",
      content_type: "photo",
      submitter_name: "Coach"
    });

    assert.equal(callCount, 1);
    assert.equal(artifacts.mode, "hermes_only");
    assert.match(artifacts.fallbackReason, /Hermes review unavailable/);
    assert.equal(artifacts.moderation.model, "local-rules");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("REVIEW_PROVIDER_MODE", originalMode);
    restoreEnv("HERMES_REVIEW_AGENT_URL", originalHermesUrl);
    restoreEnv("OPENAI_API_KEY", originalOpenAIKey);
  }
});
