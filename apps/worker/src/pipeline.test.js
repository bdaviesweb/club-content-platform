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

      if (sql.includes("FROM clubs c")) {
        return {
          rowCount: 1,
          rows: [
            {
              clubId: "club-1",
              organizationId: "org-1",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_comms",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgRoutingRule: {},
              orgPublishingRule: {},
              orgNotificationRule: {},
              clubDefaultApproverRole: null,
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: true,
              clubAutoApproveInternalLowRisk: false,
              clubAutoApproveMaxRisk: null,
              clubRoutingRule: {},
              clubPublishingRule: {},
              clubNotificationRule: {}
            }
          ]
        };
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
    const routingDecision = JSON.parse(update.params[4]);
    assert.equal(routingDecision.approverRole, "club_admin");
    assert.equal(routingDecision.reviewMode, "hermes");
    assert.equal(routingDecision.routingSource, "hermes_agent");
    assert.equal(
      routingDecision.agentRationale,
      "Medical context needs senior club review."
    );
    assert.equal(routingDecision.localPolicySource, "workflow_policy_medium_risk");

    assert.ok(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT INTO approval_requests") &&
          params[2] === "club_admin"
      )
    );
    const approvalInsert = queries.find(({ sql }) =>
      sql.includes("INSERT INTO approval_requests")
    );
    assert.match(approvalInsert.sql, /stage/);
    assert.ok(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT INTO submission_events") &&
          params[1] === "submission.approval.requested" &&
          JSON.parse(params[2]).stage === "primary" &&
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

test("prefers explicit content-type routing rules over Hermes agent overrides", async () => {
  const originalUrl = process.env.HERMES_REVIEW_AGENT_URL;
  const originalApiKey = process.env.HERMES_REVIEW_AGENT_API_KEY;
  const originalFetch = globalThis.fetch;
  const queries = [];
  const submission = {
    id: "submission-video-hermes-1",
    club_id: "club-1",
    submitted_by_user_id: "submitter-1",
    raw_text: "Video recap with player interviews.",
    visibility_target: "internal",
    content_type: "video",
    submitter_name: "Coach"
  };

  process.env.HERMES_REVIEW_AGENT_URL = "https://hermes.example.test/review";
  process.env.HERMES_REVIEW_AGENT_API_KEY = "secret";
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        id: "run-video-1",
        model: "hermes-v1",
        review: {
          risk_level: "medium",
          confidence: 0.8,
          summary: "Agent would normally choose club comms.",
          caption_draft: "Video recap",
          routing_decision: {
            approver_role: "club_comms",
            rationale: "Agent suggests comms review."
          },
          findings: []
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

      if (sql.includes("FROM clubs c")) {
        return {
          rowCount: 1,
          rows: [
            {
              clubId: "club-1",
              organizationId: "org-1",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_comms",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgRoutingRule: { contentTypeApprovers: { video: "club_admin" } },
              orgPublishingRule: {},
              orgNotificationRule: {},
              clubDefaultApproverRole: null,
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: null,
              clubAutoApproveInternalLowRisk: null,
              clubAutoApproveMaxRisk: null,
              clubRoutingRule: {},
              clubPublishingRule: {},
              clubNotificationRule: {}
            }
          ]
        };
      }

      if (sql.includes("INSERT INTO review_runs")) {
        return { rowCount: 1, rows: [{ id: "review-run-video-hermes-1" }] };
      }

      if (sql.includes("FROM memberships")) {
        return { rowCount: 1, rows: [{ id: "approver-video-hermes-1" }] };
      }

      if (sql.includes("INSERT INTO notifications")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "notification-video-hermes-1",
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
    const routingDecision = JSON.parse(update.params[4]);
    assert.equal(routingDecision.approverRole, "club_admin");
    assert.equal(routingDecision.routingSource, "local_rules");
    assert.equal(routingDecision.policySource, "routing_rule_content_type");
    assert.equal(routingDecision.agentRationale, null);
    assert.equal(routingDecision.localFallbackApproverRole, null);
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

test("routes configured content types to organization-defined approvers", async () => {
  const queries = [];
  const submission = {
    id: "submission-video-1",
    club_id: "club-1",
    submitted_by_user_id: "submitter-1",
    raw_text: "Match highlight clip.",
    visibility_target: "internal",
    content_type: "video",
    submitter_name: "Coach"
  };

  process.env.REVIEW_PROVIDER_MODE = "disabled";

  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("FROM clubs c")) {
        return {
          rowCount: 1,
          rows: [
            {
              clubId: "club-1",
              organizationId: "org-1",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_comms",
              orgAllowAgentRouting: false,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgRoutingRule: { contentTypeApprovers: { video: "club_admin" } },
              orgPublishingRule: {},
              orgNotificationRule: {},
              clubDefaultApproverRole: null,
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: null,
              clubAutoApproveInternalLowRisk: null,
              clubAutoApproveMaxRisk: null,
              clubRoutingRule: {},
              clubPublishingRule: {},
              clubNotificationRule: {}
            }
          ]
        };
      }

      if (sql.includes("INSERT INTO review_runs")) {
        return { rowCount: 1, rows: [{ id: "review-run-video-1" }] };
      }

      if (sql.includes("FROM memberships")) {
        return { rowCount: 1, rows: [{ id: "approver-video-1" }] };
      }

      if (sql.includes("INSERT INTO notifications")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "notification-video-1",
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

  await processSubmissionCreated(client, { submission_id: submission.id });

  const update = queries.find(({ sql }) => sql.includes("routing_decision"));
  const routingDecision = JSON.parse(update.params[4]);
  assert.equal(routingDecision.approverRole, "club_admin");
  assert.equal(routingDecision.policySource, "routing_rule_content_type");
  assert.equal(routingDecision.routingSource, "disabled");
  assert.equal(routingDecision.localPolicySource, null);

  assert.ok(
    queries.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO approval_requests") &&
        params[2] === "club_admin"
    )
  );
});

test("auto-approves low-risk internal submissions when club policy allows it", async () => {
  const originalMode = process.env.REVIEW_PROVIDER_MODE;
  const queries = [];
  const submission = {
    id: "submission-2",
    club_id: "club-1",
    submitted_by_user_id: "submitter-2",
    raw_text: "Great energy at practice tonight.",
    visibility_target: "internal",
    content_type: "photo",
    submitter_name: "Coach"
  };

  process.env.REVIEW_PROVIDER_MODE = "disabled";

  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("FROM clubs c")) {
        return {
          rowCount: 1,
          rows: [
            {
              clubId: "club-1",
              organizationId: "org-1",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_comms",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgPublishingRule: {},
              orgNotificationRule: {},
              clubDefaultApproverRole: "team_manager",
              clubPublicApproverRole: "club_comms",
              clubMediumRiskApproverRole: "club_comms",
              clubAllowAgentRouting: false,
              clubAutoApproveInternalLowRisk: true,
              clubAutoApproveMaxRisk: "0.20",
              clubPublishingRule: {},
              clubNotificationRule: {}
            }
          ]
        };
      }

      if (sql.includes("INSERT INTO review_runs")) {
        return { rowCount: 1, rows: [{ id: "review-run-2" }] };
      }

      return { rowCount: 1, rows: [] };
    }
  };

  try {
    await processSubmissionCreated(client, { submission_id: submission.id });

    const update = queries.find(({ sql }) => sql.includes("routing_decision"));
    const routingDecision = JSON.parse(update.params[4]);
    assert.equal(update.params[1], "approved_internal");
    assert.equal(routingDecision.autoApproved, true);
    assert.equal(
      routingDecision.autoApproveReason,
      "policy_auto_approve_low_risk_internal"
    );
    assert.equal(routingDecision.policySource, "workflow_policy_default");

    assert.equal(
      queries.some(({ sql }) => sql.includes("INSERT INTO approval_requests")),
      false
    );
    assert.equal(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT INTO submission_events") &&
          params[1] === "submission.approval.requested"
      ),
      false
    );
    assert.ok(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT INTO submission_events") &&
          params[1] === "submission.approved" &&
          JSON.parse(params[2]).autoApproved === true
      )
    );
    assert.ok(
      queries.some(
        ({ sql, params }) =>
          sql.includes("INSERT INTO audit_logs") &&
          params[0] === "submission-2" &&
          JSON.parse(params[1]).reason ===
            "policy_auto_approve_low_risk_internal"
      )
    );
    assert.equal(
      queries.some(({ sql }) => sql.includes("INSERT INTO notifications")),
      false
    );
  } finally {
    if (originalMode === undefined) {
      delete process.env.REVIEW_PROVIDER_MODE;
    } else {
      process.env.REVIEW_PROVIDER_MODE = originalMode;
    }
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
  const workflowPolicyRow = {
    clubId: "club-1",
    organizationId: "org-1",
    orgDefaultApproverRole: "team_manager",
    orgPublicApproverRole: "club_comms",
    orgMediumRiskApproverRole: "club_comms",
    orgAllowAgentRouting: true,
    orgAutoApproveInternalLowRisk: false,
    orgAutoApproveMaxRisk: "0.35",
    orgPublishingRule: { destinations: ["internal_feed"] },
    orgNotificationRule: {},
    clubDefaultApproverRole: null,
    clubPublicApproverRole: null,
    clubMediumRiskApproverRole: null,
    clubAllowAgentRouting: null,
    clubAutoApproveInternalLowRisk: null,
    clubAutoApproveMaxRisk: null,
    clubPublishingRule: null,
    clubNotificationRule: null
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("LEFT JOIN organization_workflow_policies")) {
        return { rowCount: 1, rows: [workflowPolicyRow] };
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
        JSON.parse(params[2]).destinationName === "Internal Club Feed" &&
        JSON.parse(params[2]).destinationCount === 1
    )
  );
  assert.deepEqual(notifications, [
    {
      submissionId: "submission-1",
      status: "published",
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed",
      destinationCount: 1,
      destinations: [
        {
          destinationType: "internal_feed",
          destinationName: "Internal Club Feed"
        }
      ]
    }
  ]);
});

test("publishes approved submissions to every destination configured by the workflow policy", async () => {
  const queries = [];
  const notifications = [];
  const submission = {
    id: "submission-2",
    club_id: "club-2",
    submitted_by_user_id: "user-2"
  };
  const destinations = [
    {
      id: "destination-1",
      destination_type: "internal_feed",
      name: "Internal Club Feed",
      config: { mode: "internal" }
    },
    {
      id: "destination-2",
      destination_type: "booster_email",
      name: "Booster Email",
      config: { mode: "email" }
    }
  ];
  const workflowPolicyRow = {
    clubId: "club-2",
    organizationId: "org-2",
    orgDefaultApproverRole: "team_manager",
    orgPublicApproverRole: "club_comms",
    orgMediumRiskApproverRole: "club_comms",
    orgAllowAgentRouting: true,
    orgAutoApproveInternalLowRisk: false,
    orgAutoApproveMaxRisk: "0.35",
    orgPublishingRule: { destinations: ["internal_feed", "booster_email"] },
    orgNotificationRule: {},
    clubDefaultApproverRole: null,
    clubPublicApproverRole: null,
    clubMediumRiskApproverRole: null,
    clubAllowAgentRouting: null,
    clubAutoApproveInternalLowRisk: null,
    clubAutoApproveMaxRisk: null,
    clubPublishingRule: null,
    clubNotificationRule: null
  };
  const publishCalls = [];

  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("LEFT JOIN organization_workflow_policies")) {
        return { rowCount: 1, rows: [workflowPolicyRow] };
      }

      if (sql.includes("FROM publishing_destinations")) {
        return { rowCount: 2, rows: destinations };
      }

      if (sql.includes("INSERT INTO notifications")) {
        notifications.push(JSON.parse(params[2]));
        return {
          rowCount: 1,
          rows: [
            {
              id: "notification-2",
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

  await processSubmissionApproved(
    client,
    { submission_id: submission.id },
    {
      async publishImpl(payload) {
        publishCalls.push(payload);
        return {
          destinationType: payload.destination.destination_type,
          destinationName: payload.destination.name,
          externalPostId: `${payload.destination.destination_type}:${submission.id}`,
          externalReference: `${payload.destination.destination_type}:${submission.id}`,
          resultSummary: `Published to ${payload.destination.name}`
        };
      }
    }
  );

  assert.deepEqual(
    publishCalls.map((entry) => entry.destination.destination_type),
    ["internal_feed", "booster_email"]
  );
  assert.equal(
    queries.filter(({ sql }) => sql.includes("INSERT INTO publishing_jobs")).length,
    2
  );
  assert.equal(
    queries.filter(({ sql }) => sql.includes("INSERT INTO published_posts")).length,
    2
  );
  assert.ok(
    queries.some(({ sql, params }) => {
      if (!sql.includes("INSERT INTO submission_events")) {
        return false;
      }

      const payload = JSON.parse(params[2]);
      return (
        payload.destinationCount === 2 &&
        Array.isArray(payload.destinations) &&
        payload.destinations[1]?.destinationType === "booster_email"
      );
    })
  );
  assert.deepEqual(notifications, [
    {
      submissionId: "submission-2",
      status: "published",
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed",
      destinationCount: 2,
      destinations: [
        {
          destinationType: "internal_feed",
          destinationName: "Internal Club Feed"
        },
        {
          destinationType: "booster_email",
          destinationName: "Booster Email"
        }
      ]
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
  const workflowPolicyRow = {
    clubId: "club-1",
    organizationId: "org-1",
    orgDefaultApproverRole: "team_manager",
    orgPublicApproverRole: "club_comms",
    orgMediumRiskApproverRole: "club_comms",
    orgAllowAgentRouting: true,
    orgAutoApproveInternalLowRisk: false,
    orgAutoApproveMaxRisk: "0.35",
    orgPublishingRule: { destinations: ["internal_feed"] },
    orgNotificationRule: {},
    clubDefaultApproverRole: null,
    clubPublicApproverRole: null,
    clubMediumRiskApproverRole: null,
    clubAllowAgentRouting: null,
    clubAutoApproveInternalLowRisk: null,
    clubAutoApproveMaxRisk: null,
    clubPublishingRule: null,
    clubNotificationRule: null
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes("FROM submissions s")) {
        return { rowCount: 1, rows: [submission] };
      }

      if (sql.includes("LEFT JOIN organization_workflow_policies")) {
        return { rowCount: 1, rows: [workflowPolicyRow] };
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
        JSON.parse(params[2]).error === "Destination API timed out" &&
        JSON.parse(params[2]).attemptedDestinationCount === 1
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
