import assert from "node:assert/strict";
import test from "node:test";

import {
  choosePolicyApproverRole,
  defaultWorkflowPolicy,
  loadEffectiveWorkflowPolicy,
  shouldAutoApproveSubmission
} from "./workflow-policy.js";

test("loads club workflow policy overrides ahead of organization defaults", async () => {
  const calls = [];
  const policy = await loadEffectiveWorkflowPolicy(
    {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rowCount: 1,
          rows: [
            {
              clubId: "club-1",
              organizationId: "org-1",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_admin",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgPublishingRule: { mode: "internal" },
              orgNotificationRule: { email: true },
              clubDefaultApproverRole: "club_admin",
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: false,
              clubAutoApproveInternalLowRisk: true,
              clubAutoApproveMaxRisk: "0.20",
              clubPublishingRule: { mode: "club-specific" },
              clubNotificationRule: null
            }
          ]
        };
      }
    },
    "club-1"
  );

  assert.equal(calls.length, 1);
  assert.equal(policy.clubId, "club-1");
  assert.equal(policy.organizationId, "org-1");
  assert.equal(policy.defaultApproverRole, "club_admin");
  assert.equal(policy.publicApproverRole, "club_comms");
  assert.equal(policy.mediumRiskApproverRole, "club_admin");
  assert.equal(policy.allowAgentRouting, false);
  assert.equal(policy.autoApproveInternalLowRisk, true);
  assert.equal(policy.autoApproveMaxRisk, 0.2);
  assert.deepEqual(policy.publishingRule, { mode: "club-specific" });
  assert.deepEqual(policy.notificationRule, { email: true });
});

test("falls back to organization publish and notification rules when club overrides are empty", async () => {
  const policy = await loadEffectiveWorkflowPolicy(
    {
      async query() {
        return {
          rowCount: 1,
          rows: [
            {
              clubId: "club-1",
              organizationId: "org-1",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_admin",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgPublishingRule: { destinations: ["internal_feed"] },
              orgNotificationRule: { email: true, push: false },
              clubDefaultApproverRole: null,
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: null,
              clubAutoApproveInternalLowRisk: null,
              clubAutoApproveMaxRisk: null,
              clubPublishingRule: {},
              clubNotificationRule: {}
            }
          ]
        };
      }
    },
    "club-1"
  );

  assert.deepEqual(policy.publishingRule, { destinations: ["internal_feed"] });
  assert.deepEqual(policy.notificationRule, { email: true, push: false });
});

test("falls back to the default workflow policy when a club has no policy rows yet", async () => {
  const policy = await loadEffectiveWorkflowPolicy(
    {
      async query() {
        return { rowCount: 0, rows: [] };
      }
    },
    "club-2"
  );

  assert.deepEqual(policy, {
    ...defaultWorkflowPolicy,
    clubId: "club-2",
    organizationId: null
  });
});

test("chooses approvers from policy by visibility and risk", () => {
  const policy = {
    ...defaultWorkflowPolicy,
    defaultApproverRole: "team_manager",
    publicApproverRole: "club_admin",
    mediumRiskApproverRole: "club_comms"
  };

  assert.equal(
    choosePolicyApproverRole({
      visibilityTarget: "internal",
      riskScore: 0.1,
      policy
    }),
    "team_manager"
  );
  assert.equal(
    choosePolicyApproverRole({
      visibilityTarget: "internal",
      riskScore: 0.6,
      policy
    }),
    "club_comms"
  );
  assert.equal(
    choosePolicyApproverRole({
      visibilityTarget: "public",
      riskScore: 0.1,
      policy
    }),
    "club_admin"
  );
});

test("allows low-risk internal auto-approval only when policy permits it", () => {
  const enabledPolicy = {
    ...defaultWorkflowPolicy,
    autoApproveInternalLowRisk: true,
    autoApproveMaxRisk: 0.2
  };
  const disabledPolicy = {
    ...defaultWorkflowPolicy,
    autoApproveInternalLowRisk: false
  };

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "internal" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: enabledPolicy
    }),
    { allowed: true, reason: "policy_auto_approve_low_risk_internal" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "public" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: enabledPolicy
    }),
    { allowed: false, reason: "visibility_requires_review" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "internal" },
      reviewArtifacts: { riskScore: 0.25, moderation: { flagged: false } },
      policy: enabledPolicy
    }),
    { allowed: false, reason: "risk_above_policy_threshold" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "internal" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: disabledPolicy
    }),
    { allowed: false, reason: "policy_disabled" }
  );
});
