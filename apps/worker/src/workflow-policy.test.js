import assert from "node:assert/strict";
import test from "node:test";

import {
  choosePublishingDestinationTypes,
  describePolicyApproverSource,
  choosePolicyApproverRole,
  defaultWorkflowPolicy,
  loadEffectiveWorkflowPolicy,
  shouldRequireSecondApproval,
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
              orgAutoApprovalRule: { allowedContentTypes: ["photo"] },
              orgRoutingRule: { contentTypeApprovers: { video: "club_admin" } },
              orgApprovalRule: { requireSecondApprovalForPublic: true, secondApproverRole: "club_admin" },
              orgPublishingRule: { mode: "internal" },
              orgNotificationRule: { email: true },
              clubDefaultApproverRole: "club_admin",
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: false,
              clubAutoApproveInternalLowRisk: true,
              clubAutoApproveMaxRisk: "0.20",
              clubAutoApprovalRule: {},
              clubRoutingRule: {},
              clubApprovalRule: { requireSecondApprovalForPublic: false },
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
  assert.deepEqual(policy.autoApprovalRule, {
    allowedContentTypes: ["photo"]
  });
  assert.deepEqual(policy.routingRule, {
    contentTypeApprovers: { video: "club_admin" }
  });
  assert.deepEqual(policy.approvalRule, {
    requireSecondApprovalForPublic: false
  });
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
              orgAutoApprovalRule: { allowedContentTypes: ["photo"] },
              orgRoutingRule: {
                contentTypeApprovers: { video: "club_admin" }
              },
              orgApprovalRule: {
                requireSecondApprovalForPublic: true,
                secondApproverRole: "club_admin"
              },
              orgPublishingRule: { destinations: ["internal_feed"] },
              orgNotificationRule: { email: true, push: false },
              clubDefaultApproverRole: null,
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: null,
              clubAutoApproveInternalLowRisk: null,
              clubAutoApproveMaxRisk: null,
              clubAutoApprovalRule: {},
              clubRoutingRule: {},
              clubPublishingRule: {},
              clubNotificationRule: {}
            }
          ]
        };
      }
    },
    "club-1"
  );

  assert.deepEqual(policy.autoApprovalRule, {
    allowedContentTypes: ["photo"]
  });
  assert.deepEqual(policy.routingRule, {
    contentTypeApprovers: { video: "club_admin" }
  });
  assert.deepEqual(policy.approvalRule, {
    requireSecondApprovalForPublic: true,
    secondApproverRole: "club_admin"
  });
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
      contentType: "video",
      policy: {
        ...policy,
        routingRule: { contentTypeApprovers: { video: "club_admin" } }
      }
    }),
    "club_admin"
  );
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

test("describes policy approver source for content type, visibility, risk, and default paths", () => {
  const policy = {
    ...defaultWorkflowPolicy,
    routingRule: { contentTypeApprovers: { video: "club_admin" } }
  };

  assert.equal(
    describePolicyApproverSource({
      visibilityTarget: "internal",
      riskScore: 0.1,
      contentType: "video",
      policy
    }),
    "routing_rule_content_type"
  );
  assert.equal(
    describePolicyApproverSource({
      visibilityTarget: "public",
      riskScore: 0.1,
      contentType: "photo",
      policy
    }),
    "workflow_policy_public"
  );
  assert.equal(
    describePolicyApproverSource({
      visibilityTarget: "internal",
      riskScore: 0.6,
      contentType: "photo",
      policy
    }),
    "workflow_policy_medium_risk"
  );
  assert.equal(
    describePolicyApproverSource({
      visibilityTarget: "internal",
      riskScore: 0.1,
      contentType: "photo",
      policy
    }),
    "workflow_policy_default"
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
      submission: { visibility_target: "internal", content_type: "photo" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: {
        ...enabledPolicy,
        autoApprovalRule: { allowedContentTypes: ["photo"] }
      }
    }),
    { allowed: true, reason: "policy_auto_approve_low_risk_internal" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "public", content_type: "photo" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: enabledPolicy
    }),
    { allowed: false, reason: "visibility_requires_review" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "internal", content_type: "photo" },
      reviewArtifacts: { riskScore: 0.25, moderation: { flagged: false } },
      policy: enabledPolicy
    }),
    { allowed: false, reason: "risk_above_policy_threshold" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "internal", content_type: "photo" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: disabledPolicy
    }),
    { allowed: false, reason: "policy_disabled" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "internal", content_type: "video" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: {
        ...enabledPolicy,
        autoApprovalRule: { allowedContentTypes: ["photo"] }
      }
    }),
    { allowed: false, reason: "content_type_not_auto_approvable" }
  );

  assert.deepEqual(
    shouldAutoApproveSubmission({
      submission: { visibility_target: "internal", content_type: "photo" },
      reviewArtifacts: { riskScore: 0.15, moderation: { flagged: false } },
      policy: {
        ...enabledPolicy,
        autoApprovalRule: { blockedContentTypes: ["photo"] }
      }
    }),
    { allowed: false, reason: "content_type_blocked" }
  );
});

test("chooses publish destinations from policy and falls back to internal feed", () => {
  assert.deepEqual(
    choosePublishingDestinationTypes({
      ...defaultWorkflowPolicy,
      publishingRule: { destinations: ["internal_feed", "booster_email", "internal_feed"] }
    }),
    ["internal_feed", "booster_email"]
  );

  assert.deepEqual(
    choosePublishingDestinationTypes({
      ...defaultWorkflowPolicy,
      publishingRule: { destinations: [] }
    }),
    ["internal_feed"]
  );

  assert.deepEqual(choosePublishingDestinationTypes(defaultWorkflowPolicy), [
    "internal_feed"
  ]);
});

test("requires second approval for public submissions when policy enables it", () => {
  const policy = {
    ...defaultWorkflowPolicy,
    approvalRule: {
      requireSecondApprovalForPublic: true,
      secondApproverRole: "club_admin"
    }
  };

  assert.deepEqual(
    shouldRequireSecondApproval({
      submission: { visibility_target: "public" },
      policy
    }),
    {
      required: true,
      reason: "policy_requires_second_public_approval",
      secondApproverRole: "club_admin"
    }
  );

  assert.deepEqual(
    shouldRequireSecondApproval({
      submission: { visibility_target: "internal" },
      policy
    }),
    {
      required: false,
      reason: "visibility_not_public"
    }
  );
});
