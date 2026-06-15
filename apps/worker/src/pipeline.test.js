import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewArtifacts,
  processSubmissionCreated,
  processSubmissionApproved
} from "./pipeline.js";

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

test("records Hermes fallback reasons in review artifacts", async () => {
  const originalUrl = process.env.HERMES_REVIEW_AGENT_URL;
  const originalMode = process.env.HERMES_REVIEW_AGENT_MODE;
  const originalApiKey = process.env.HERMES_REVIEW_AGENT_API_KEY;
  const originalFetch = globalThis.fetch;

  process.env.HERMES_REVIEW_AGENT_URL = "https://hermes.example.test/v1/responses";
  process.env.HERMES_REVIEW_AGENT_MODE = "responses_api";
  process.env.HERMES_REVIEW_AGENT_API_KEY = "secret";
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        output_text:
          "Error code: 402 - Prompt tokens limit exceeded: 27882 > 24585"
      };
    }
  });

  try {
    const artifacts = await buildReviewArtifacts({
      raw_text: "Simple team update.",
      visibility_target: "internal",
      content_type: "photo",
      submitter_name: "Coach"
    });

    assert.equal(artifacts.mode, "fallback");
    assert.match(
      artifacts.fallbackReason,
      /Hermes review unavailable: Hermes Responses API returned invalid review JSON/
    );
    assert.match(artifacts.summary, /Prompt tokens limit exceeded/);
  } finally {
    if (originalUrl === undefined) {
      delete process.env.HERMES_REVIEW_AGENT_URL;
    } else {
      process.env.HERMES_REVIEW_AGENT_URL = originalUrl;
    }

    if (originalMode === undefined) {
      delete process.env.HERMES_REVIEW_AGENT_MODE;
    } else {
      process.env.HERMES_REVIEW_AGENT_MODE = originalMode;
    }

    if (originalApiKey === undefined) {
      delete process.env.HERMES_REVIEW_AGENT_API_KEY;
    } else {
      process.env.HERMES_REVIEW_AGENT_API_KEY = originalApiKey;
    }

    globalThis.fetch = originalFetch;
  }
});

test("routes approval requests with the Hermes agent decision", async () => {
  const originalUrl = process.env.HERMES_REVIEW_AGENT_URL;
  const originalApiKey = process.env.HERMES_REVIEW_AGENT_API_KEY;
  const originalFetch = globalThis.fetch;
  const queries = [];
  const submission = {
    id: "submission-1",
    club_id: "club-1",
    submitted_by_user_id: "submitter-1",
    raw_text: "Player may need a medical check after the match.",
    visibility_target: "internal",
    content_type: "photo",
    submitter_name: "Coach"
  };

  process.env.HERMES_REVIEW_AGENT_URL = "https://hermes.example.test/review";
  process.env.HERMES_REVIEW_AGENT_API_KEY = "secret";
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        id: "run-1",
        model: "hermes-v1",
        review: {
          risk_level: "medium",
          confidence: 0.82,
          summary: "Medical detail should go to admin review.",
          caption_draft: "Team update from today's match.",
          review_required_reason: "Medical detail",
          routing_decision: {
            approver_role: "club_admin",
            rationale: "Medical context needs senior club review."
          },
          findings: [
            {
              type: "safety",
              severity: "medium",
              message: "Mentions a possible medical check."
            }
          ]
        }
      };
    }
  });

  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("INSERT INTO review_runs")) {
        return { rowCount: 1, rows: [{ id: "review-run-1" }] };
      }

      if (sql.includes("FROM memberships")) {
        return { rowCount: 1, rows: [{ id: "approver-1" }] };
      }

      if (sql.includes("INSERT INTO notifications")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "notification-1",
              user_id: params[0],
              type: params[1],
              payload: JSON.parse(params[2]),
              created_at: new Date().toISOString()
            }
          ]
        };
      }

      if (sql.includes("SELECT email, full_name")) {
        return {
          rowCount: 1,
          rows: [{ email: "submitter@example.test", full_name: "Submitter" }]
        };
      }

      if (sql.includes("WITH latest_push_state")) {
        return { rowCount: 0, rows: [] };
      }

      return { rowCount: 1, rows: [] };
    }
  };

  try {
    await processSubmissionCreated(client, { submission_id: submission.id });

    const update = queries.find(({ sql }) => sql.includes("routing_decision"));
    const routingDecision = JSON.parse(update.params[3]);
    assert.equal(routingDecision.approverRole, "club_admin");
    assert.equal(routingDecision.reviewMode, "hermes");
    assert.equal(routingDecision.routingSource, "hermes_agent");
    assert.equal(
      routingDecision.agentRationale,
      "Medical context needs senior club review."
    );

    assert.ok(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT INTO approval_requests") &&
          params[2] === "club_admin"
      )
    );
    assert.ok(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT INTO submission_events") &&
          params[1] === "submission.approval.requested" &&
          JSON.parse(params[2]).originallyRequestedRole === "club_admin"
      )
    );
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

test("publishes approved submissions through the destination adapter", async () => {
  const queries = [];
  const notifications = [];
  const submission = {
    id: "submission-1",
    club_id: "club-1",
    submitted_by_user_id: "user-1"
  };
  const destination = {
    id: "destination-1",
    destination_type: "internal_feed",
    name: "Internal Club Feed",
    config: { mode: "internal" }
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("FROM publishing_destinations")) {
        return { rowCount: 1, rows: [destination] };
      }

      if (sql.includes("INSERT INTO notifications")) {
        notifications.push(JSON.parse(params[2]));
        return {
          rowCount: 1,
          rows: [
            {
              id: "notification-1",
              user_id: params[0],
              type: params[1],
              payload: JSON.parse(params[2]),
              created_at: new Date().toISOString()
            }
          ]
        };
      }

      if (sql.includes("FROM users")) {
        return {
          rowCount: 1,
          rows: [{ email: "submitter@example.test", full_name: "Submitter" }]
        };
      }

      if (sql.includes("WITH latest_push_state")) {
        return { rowCount: 0, rows: [] };
      }

      return { rowCount: 1, rows: [] };
    }
  };
  const publishCalls = [];

  await processSubmissionApproved(
    client,
    { submission_id: submission.id },
    {
      async publishImpl(payload) {
        publishCalls.push(payload);
        return {
          destinationType: "internal_feed",
          destinationName: "Internal Club Feed",
          externalPostId: "internal:submission-1",
          externalReference: "internal:submission-1",
          resultSummary: "Published to internal feed by worker"
        };
      }
    }
  );

  assert.deepEqual(publishCalls, [{ submission, destination }]);
  assert.ok(
    queries.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO publishing_jobs") &&
        params[2] === "Published to internal feed by worker" &&
        params[3] === "internal:submission-1"
    )
  );
  assert.ok(
    queries.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO published_posts") &&
        params[2] === "internal:submission-1"
    )
  );
  assert.ok(
    queries.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO submission_events") &&
        JSON.parse(params[2]).destinationName === "Internal Club Feed"
    )
  );
  assert.deepEqual(notifications, [
    {
      submissionId: "submission-1",
      status: "published",
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed"
    }
  ]);
});

test("records publish failures when the destination adapter fails", async () => {
  const queries = [];
  const submission = {
    id: "submission-1",
    club_id: "club-1",
    submitted_by_user_id: "user-1"
  };
  const destination = {
    id: "destination-1",
    destination_type: "internal_feed",
    name: "Internal Club Feed",
    config: { mode: "internal" }
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("FROM publishing_destinations")) {
        return { rowCount: 1, rows: [destination] };
      }

      return { rowCount: 1, rows: [] };
    }
  };

  await processSubmissionApproved(
    client,
    { submission_id: submission.id },
    {
      async publishImpl() {
        throw new Error("Destination API timed out");
      }
    }
  );

  assert.ok(
    queries.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO publishing_jobs") &&
        sql.includes("'failed'") &&
        params[2] === "Publishing failed: Destination API timed out"
    )
  );
  assert.ok(
    queries.some(
      ({ sql, params }) =>
        sql.includes("UPDATE submissions") &&
        sql.includes("publish_failed") &&
        params[0] === "submission-1"
    )
  );
  assert.ok(
    queries.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO submission_events") &&
        params[1] === "submission.publish.failed" &&
        JSON.parse(params[2]).error === "Destination API timed out"
    )
  );
  assert.equal(
    queries.some(({ sql }) => sql.includes("INSERT INTO published_posts")),
    false
  );
  assert.equal(
    queries.some(({ sql }) => sql.includes("INSERT INTO notifications")),
    false
  );
});
