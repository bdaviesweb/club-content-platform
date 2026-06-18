import {
  internalDestinationType,
  reviewThresholds
} from "../../../packages/shared/src/index.js";

export const defaultWorkflowPolicy = {
  defaultApproverRole: "team_manager",
  publicApproverRole: "club_comms",
  mediumRiskApproverRole: "club_comms",
  allowAgentRouting: true,
  autoApproveInternalLowRisk: false,
  autoApproveMaxRisk: reviewThresholds.mediumRisk,
  approvalRule: {},
  publishingRule: {},
  notificationRule: {}
};

function parseMaybeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMaybeJson(value, fallback = {}) {
  if (!value) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseOverrideJson(value) {
  const parsed = parseMaybeJson(value, null);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  return Object.keys(parsed).length ? parsed : null;
}

function pickOverride(clubValue, orgValue, fallbackValue) {
  if (clubValue !== null && clubValue !== undefined) {
    return clubValue;
  }

  if (orgValue !== null && orgValue !== undefined) {
    return orgValue;
  }

  return fallbackValue;
}

export async function loadEffectiveWorkflowPolicy(client, clubId) {
  const result = await client.query(
    `
    SELECT
      c.id AS "clubId",
      c.organization_id AS "organizationId",
      op.default_approver_role AS "orgDefaultApproverRole",
      op.public_approver_role AS "orgPublicApproverRole",
      op.medium_risk_approver_role AS "orgMediumRiskApproverRole",
      op.allow_agent_routing AS "orgAllowAgentRouting",
      op.auto_approve_internal_low_risk AS "orgAutoApproveInternalLowRisk",
      op.auto_approve_max_risk AS "orgAutoApproveMaxRisk",
      op.approval_rule AS "orgApprovalRule",
      op.publishing_rule AS "orgPublishingRule",
      op.notification_rule AS "orgNotificationRule",
      cp.default_approver_role AS "clubDefaultApproverRole",
      cp.public_approver_role AS "clubPublicApproverRole",
      cp.medium_risk_approver_role AS "clubMediumRiskApproverRole",
      cp.allow_agent_routing AS "clubAllowAgentRouting",
      cp.auto_approve_internal_low_risk AS "clubAutoApproveInternalLowRisk",
      cp.auto_approve_max_risk AS "clubAutoApproveMaxRisk",
      cp.approval_rule AS "clubApprovalRule",
      cp.publishing_rule AS "clubPublishingRule",
      cp.notification_rule AS "clubNotificationRule"
    FROM clubs c
    LEFT JOIN organization_workflow_policies op
      ON op.organization_id = c.organization_id
    LEFT JOIN club_workflow_policies cp
      ON cp.club_id = c.id
    WHERE c.id = $1
    LIMIT 1
    `,
    [clubId]
  );

  if (!result.rowCount) {
    return { ...defaultWorkflowPolicy, clubId, organizationId: null };
  }

  const row = result.rows[0];

  return {
    clubId: row.clubId,
    organizationId: row.organizationId || null,
    defaultApproverRole: pickOverride(
      row.clubDefaultApproverRole,
      row.orgDefaultApproverRole,
      defaultWorkflowPolicy.defaultApproverRole
    ),
    publicApproverRole: pickOverride(
      row.clubPublicApproverRole,
      row.orgPublicApproverRole,
      defaultWorkflowPolicy.publicApproverRole
    ),
    mediumRiskApproverRole: pickOverride(
      row.clubMediumRiskApproverRole,
      row.orgMediumRiskApproverRole,
      defaultWorkflowPolicy.mediumRiskApproverRole
    ),
    allowAgentRouting: pickOverride(
      row.clubAllowAgentRouting,
      row.orgAllowAgentRouting,
      defaultWorkflowPolicy.allowAgentRouting
    ),
    autoApproveInternalLowRisk: pickOverride(
      row.clubAutoApproveInternalLowRisk,
      row.orgAutoApproveInternalLowRisk,
      defaultWorkflowPolicy.autoApproveInternalLowRisk
    ),
    autoApproveMaxRisk: parseMaybeNumber(
      pickOverride(
        row.clubAutoApproveMaxRisk,
        row.orgAutoApproveMaxRisk,
        defaultWorkflowPolicy.autoApproveMaxRisk
      ),
      defaultWorkflowPolicy.autoApproveMaxRisk
    ),
    approvalRule: pickOverride(
      parseOverrideJson(row.clubApprovalRule),
      parseMaybeJson(row.orgApprovalRule, null),
      defaultWorkflowPolicy.approvalRule
    ),
    publishingRule: pickOverride(
      parseOverrideJson(row.clubPublishingRule),
      parseMaybeJson(row.orgPublishingRule, null),
      defaultWorkflowPolicy.publishingRule
    ),
    notificationRule: pickOverride(
      parseOverrideJson(row.clubNotificationRule),
      parseMaybeJson(row.orgNotificationRule, null),
      defaultWorkflowPolicy.notificationRule
    )
  };
}

export function choosePolicyApproverRole({
  visibilityTarget,
  riskScore,
  policy = defaultWorkflowPolicy
}) {
  if (visibilityTarget === "public") {
    return policy.publicApproverRole;
  }

  if (Number(riskScore) >= reviewThresholds.mediumRisk) {
    return policy.mediumRiskApproverRole;
  }

  return policy.defaultApproverRole;
}

export function shouldAutoApproveSubmission({
  submission,
  reviewArtifacts,
  policy = defaultWorkflowPolicy
}) {
  if (!policy.autoApproveInternalLowRisk) {
    return { allowed: false, reason: "policy_disabled" };
  }

  if (submission.visibility_target !== "internal") {
    return { allowed: false, reason: "visibility_requires_review" };
  }

  if (Number(reviewArtifacts.riskScore) > Number(policy.autoApproveMaxRisk)) {
    return { allowed: false, reason: "risk_above_policy_threshold" };
  }

  if (reviewArtifacts.moderation?.flagged) {
    return { allowed: false, reason: "moderation_flagged" };
  }

  return { allowed: true, reason: "policy_auto_approve_low_risk_internal" };
}

export function choosePublishingDestinationTypes(
  policy = defaultWorkflowPolicy
) {
  const configuredDestinations = policy?.publishingRule?.destinations;

  if (!Array.isArray(configuredDestinations)) {
    return [internalDestinationType];
  }

  const normalized = configuredDestinations
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!normalized.length) {
    return [internalDestinationType];
  }

  return [...new Set(normalized)];
}

export function shouldRequireSecondApproval({
  submission,
  policy = defaultWorkflowPolicy
}) {
  const rule = policy?.approvalRule || {};

  if (!rule?.requireSecondApprovalForPublic) {
    return { required: false, reason: "policy_disabled" };
  }

  if (submission.visibility_target !== "public") {
    return { required: false, reason: "visibility_not_public" };
  }

  return {
    required: true,
    reason: "policy_requires_second_public_approval",
    secondApproverRole: rule.secondApproverRole || "club_admin"
  };
}
