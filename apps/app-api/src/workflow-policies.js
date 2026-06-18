const defaultWorkflowPolicy = {
  defaultApproverRole: "team_manager",
  publicApproverRole: "club_comms",
  mediumRiskApproverRole: "club_comms",
  allowAgentRouting: true,
  autoApproveInternalLowRisk: false,
  autoApproveMaxRisk: 0.35,
  routingRule: {},
  approvalRule: {},
  publishingRule: {},
  notificationRule: {}
};

const reviewerWorkflowRoles = ["team_manager", "club_admin", "club_comms"];
const clubPolicyManagerRoles = ["club_admin", "club_comms"];
const organizationPolicyManagerRoles = ["organization_admin", "organization_ops"];

function validateDestinationList(value, fieldName) {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: `${fieldName}.destinations must be an array of destination type strings`
    };
  }

  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      return {
        ok: false,
        error: `${fieldName}.destinations must contain only non-empty strings`
      };
    }
  }

  return { ok: true };
}

function normalizeSlug(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined) {
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

function normalizePolicyObject(value, { treatEmptyAsNull = false } = {}) {
  const parsed = parseMaybeJson(value, null);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  if (treatEmptyAsNull && !Object.keys(parsed).length) {
    return null;
  }

  return parsed;
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

function normalizeStoredPolicyRow(row, { scopeType }) {
  if (!row) {
    return null;
  }

  const treatEmptyAsNull = scopeType === "club";

  return {
    defaultApproverRole: row.defaultApproverRole || null,
    publicApproverRole: row.publicApproverRole || null,
    mediumRiskApproverRole: row.mediumRiskApproverRole || null,
    allowAgentRouting:
      row.allowAgentRouting === null || row.allowAgentRouting === undefined
        ? null
        : Boolean(row.allowAgentRouting),
    autoApproveInternalLowRisk:
      row.autoApproveInternalLowRisk === null ||
      row.autoApproveInternalLowRisk === undefined
        ? null
        : Boolean(row.autoApproveInternalLowRisk),
    autoApproveMaxRisk:
      row.autoApproveMaxRisk === null || row.autoApproveMaxRisk === undefined
        ? null
        : Number(row.autoApproveMaxRisk),
    routingRule: normalizePolicyObject(row.routingRule, {
      treatEmptyAsNull
    }),
    approvalRule: normalizePolicyObject(row.approvalRule, {
      treatEmptyAsNull
    }),
    publishingRule: normalizePolicyObject(row.publishingRule, {
      treatEmptyAsNull
    }),
    notificationRule: normalizePolicyObject(row.notificationRule, {
      treatEmptyAsNull
    })
  };
}

function buildClubPolicyResponse(row) {
  if (!row) {
    return { found: false };
  }

  const organizationPolicy = normalizeStoredPolicyRow(
    {
      defaultApproverRole: row.orgDefaultApproverRole,
      publicApproverRole: row.orgPublicApproverRole,
      mediumRiskApproverRole: row.orgMediumRiskApproverRole,
      allowAgentRouting: row.orgAllowAgentRouting,
      autoApproveInternalLowRisk: row.orgAutoApproveInternalLowRisk,
      autoApproveMaxRisk: row.orgAutoApproveMaxRisk,
      routingRule: row.orgRoutingRule,
      approvalRule: row.orgApprovalRule,
      publishingRule: row.orgPublishingRule,
      notificationRule: row.orgNotificationRule
    },
    { scopeType: "organization" }
  );

  const clubPolicy = normalizeStoredPolicyRow(
    {
      defaultApproverRole: row.clubDefaultApproverRole,
      publicApproverRole: row.clubPublicApproverRole,
      mediumRiskApproverRole: row.clubMediumRiskApproverRole,
      allowAgentRouting: row.clubAllowAgentRouting,
      autoApproveInternalLowRisk: row.clubAutoApproveInternalLowRisk,
      autoApproveMaxRisk: row.clubAutoApproveMaxRisk,
      routingRule: row.clubRoutingRule,
      approvalRule: row.clubApprovalRule,
      publishingRule: row.clubPublishingRule,
      notificationRule: row.clubNotificationRule
    },
    { scopeType: "club" }
  );

  return {
    found: true,
    scopeType: "club",
    organization: row.organizationId
      ? {
          id: row.organizationId,
          slug: row.organizationSlug,
          name: row.organizationName
        }
      : null,
    club: {
      id: row.clubId,
      slug: row.clubSlug,
      name: row.clubName
    },
    organizationPolicy,
    clubPolicy,
    effectivePolicy: {
      defaultApproverRole: pickOverride(
        clubPolicy.defaultApproverRole,
        organizationPolicy?.defaultApproverRole,
        defaultWorkflowPolicy.defaultApproverRole
      ),
      publicApproverRole: pickOverride(
        clubPolicy.publicApproverRole,
        organizationPolicy?.publicApproverRole,
        defaultWorkflowPolicy.publicApproverRole
      ),
      mediumRiskApproverRole: pickOverride(
        clubPolicy.mediumRiskApproverRole,
        organizationPolicy?.mediumRiskApproverRole,
        defaultWorkflowPolicy.mediumRiskApproverRole
      ),
      allowAgentRouting: pickOverride(
        clubPolicy.allowAgentRouting,
        organizationPolicy?.allowAgentRouting,
        defaultWorkflowPolicy.allowAgentRouting
      ),
      autoApproveInternalLowRisk: pickOverride(
        clubPolicy.autoApproveInternalLowRisk,
        organizationPolicy?.autoApproveInternalLowRisk,
        defaultWorkflowPolicy.autoApproveInternalLowRisk
      ),
      autoApproveMaxRisk: pickOverride(
        clubPolicy.autoApproveMaxRisk,
        organizationPolicy?.autoApproveMaxRisk,
        defaultWorkflowPolicy.autoApproveMaxRisk
      ),
      routingRule: pickOverride(
        clubPolicy.routingRule,
        organizationPolicy?.routingRule,
        defaultWorkflowPolicy.routingRule
      ),
      approvalRule: pickOverride(
        clubPolicy.approvalRule,
        organizationPolicy?.approvalRule,
        defaultWorkflowPolicy.approvalRule
      ),
      publishingRule: pickOverride(
        clubPolicy.publishingRule,
        organizationPolicy?.publishingRule,
        defaultWorkflowPolicy.publishingRule
      ),
      notificationRule: pickOverride(
        clubPolicy.notificationRule,
        organizationPolicy?.notificationRule,
        defaultWorkflowPolicy.notificationRule
      )
    }
  };
}

function buildOrganizationPolicyResponse(row) {
  if (!row) {
    return { found: false };
  }

  return {
    found: true,
    scopeType: "organization",
    organization: {
      id: row.organizationId,
      slug: row.organizationSlug,
      name: row.organizationName
    },
    organizationPolicy: normalizeStoredPolicyRow(
      {
        defaultApproverRole: row.orgDefaultApproverRole,
        publicApproverRole: row.orgPublicApproverRole,
        mediumRiskApproverRole: row.orgMediumRiskApproverRole,
        allowAgentRouting: row.orgAllowAgentRouting,
        autoApproveInternalLowRisk: row.orgAutoApproveInternalLowRisk,
        autoApproveMaxRisk: row.orgAutoApproveMaxRisk,
        routingRule: row.orgRoutingRule,
        approvalRule: row.orgApprovalRule,
        publishingRule: row.orgPublishingRule,
        notificationRule: row.orgNotificationRule
      },
      { scopeType: "organization" }
    )
  };
}

export function validateWorkflowPolicyPatch(input, { scopeType }) {
  const patch = {};

  for (const roleField of [
    "defaultApproverRole",
    "publicApproverRole",
    "mediumRiskApproverRole"
  ]) {
    if (!Object.hasOwn(input, roleField)) {
      continue;
    }

    const value = input[roleField];

    if (value === null) {
      patch[roleField] = null;
      continue;
    }

    if (!reviewerWorkflowRoles.includes(value)) {
      return {
        ok: false,
        error: `${roleField} must be one of ${reviewerWorkflowRoles.join(", ")}`
      };
    }

    patch[roleField] = value;
  }

  for (const booleanField of [
    "allowAgentRouting",
    "autoApproveInternalLowRisk"
  ]) {
    if (!Object.hasOwn(input, booleanField)) {
      continue;
    }

    const value = input[booleanField];

    if (value === null) {
      if (scopeType === "organization") {
        return {
          ok: false,
          error: `${booleanField} cannot be null for organization policies`
        };
      }

      patch[booleanField] = null;
      continue;
    }

    if (typeof value !== "boolean") {
      return { ok: false, error: `${booleanField} must be a boolean` };
    }

    patch[booleanField] = value;
  }

  if (Object.hasOwn(input, "autoApproveMaxRisk")) {
    const value = input.autoApproveMaxRisk;

    if (value === null) {
      patch.autoApproveMaxRisk = null;
    } else if (typeof value !== "number" || Number.isNaN(value)) {
      return {
        ok: false,
        error: "autoApproveMaxRisk must be a number between 0 and 1"
      };
    } else if (value < 0 || value > 1) {
      return {
        ok: false,
        error: "autoApproveMaxRisk must be between 0 and 1"
      };
    } else {
      patch.autoApproveMaxRisk = value;
    }
  }

  for (const objectField of ["routingRule", "approvalRule", "publishingRule", "notificationRule"]) {
    if (!Object.hasOwn(input, objectField)) {
      continue;
    }

    const value = input[objectField];

    if (value === null) {
      patch[objectField] = null;
      continue;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: `${objectField} must be an object` };
    }

    if (objectField === "routingRule") {
      if (Object.hasOwn(value, "contentTypeApprovers")) {
        const approvers = value.contentTypeApprovers;

        if (!approvers || typeof approvers !== "object" || Array.isArray(approvers)) {
          return {
            ok: false,
            error: "routingRule.contentTypeApprovers must be an object"
          };
        }

        for (const [contentType, role] of Object.entries(approvers)) {
          if (typeof contentType !== "string" || !contentType.trim()) {
            return {
              ok: false,
              error: "routingRule.contentTypeApprovers keys must be non-empty content types"
            };
          }

          if (!reviewerWorkflowRoles.includes(role)) {
            return {
              ok: false,
              error: `routingRule.contentTypeApprovers values must be one of ${reviewerWorkflowRoles.join(", ")}`
            };
          }
        }
      }
    }

    if (objectField === "approvalRule") {
      if (
        Object.hasOwn(value, "requireSecondApprovalForPublic") &&
        typeof value.requireSecondApprovalForPublic !== "boolean"
      ) {
        return {
          ok: false,
          error: "approvalRule.requireSecondApprovalForPublic must be a boolean"
        };
      }

      if (
        Object.hasOwn(value, "secondApproverRole") &&
        !reviewerWorkflowRoles.includes(value.secondApproverRole)
      ) {
        return {
          ok: false,
          error: `approvalRule.secondApproverRole must be one of ${reviewerWorkflowRoles.join(", ")}`
        };
      }
    }

    if (
      objectField === "publishingRule" &&
      Object.hasOwn(value, "destinations")
    ) {
      const validation = validateDestinationList(value.destinations, objectField);
      if (!validation.ok) {
        return validation;
      }
    }

    patch[objectField] = value;
  }

  return { ok: true, value: patch };
}

async function queryClubPolicyRow(client, clubSlug) {
  const result = await client.query(
    `
    SELECT
      c.id AS "clubId",
      c.slug AS "clubSlug",
      c.name AS "clubName",
      o.id AS "organizationId",
      o.slug AS "organizationSlug",
      o.name AS "organizationName",
      op.default_approver_role AS "orgDefaultApproverRole",
      op.public_approver_role AS "orgPublicApproverRole",
      op.medium_risk_approver_role AS "orgMediumRiskApproverRole",
      op.allow_agent_routing AS "orgAllowAgentRouting",
      op.auto_approve_internal_low_risk AS "orgAutoApproveInternalLowRisk",
      op.auto_approve_max_risk AS "orgAutoApproveMaxRisk",
      op.routing_rule AS "orgRoutingRule",
      op.approval_rule AS "orgApprovalRule",
      op.publishing_rule AS "orgPublishingRule",
      op.notification_rule AS "orgNotificationRule",
      cp.default_approver_role AS "clubDefaultApproverRole",
      cp.public_approver_role AS "clubPublicApproverRole",
      cp.medium_risk_approver_role AS "clubMediumRiskApproverRole",
      cp.allow_agent_routing AS "clubAllowAgentRouting",
      cp.auto_approve_internal_low_risk AS "clubAutoApproveInternalLowRisk",
      cp.auto_approve_max_risk AS "clubAutoApproveMaxRisk",
      cp.routing_rule AS "clubRoutingRule",
      cp.approval_rule AS "clubApprovalRule",
      cp.publishing_rule AS "clubPublishingRule",
      cp.notification_rule AS "clubNotificationRule"
    FROM clubs c
    LEFT JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN organization_workflow_policies op
      ON op.organization_id = c.organization_id
    LEFT JOIN club_workflow_policies cp
      ON cp.club_id = c.id
    WHERE c.slug = $1
    LIMIT 1
    `,
    [clubSlug]
  );

  return result.rows[0] || null;
}

async function queryClubPolicyRowById(client, clubId) {
  const result = await client.query(
    `
    SELECT
      c.id AS "clubId",
      c.slug AS "clubSlug",
      c.name AS "clubName",
      o.id AS "organizationId",
      o.slug AS "organizationSlug",
      o.name AS "organizationName",
      op.default_approver_role AS "orgDefaultApproverRole",
      op.public_approver_role AS "orgPublicApproverRole",
      op.medium_risk_approver_role AS "orgMediumRiskApproverRole",
      op.allow_agent_routing AS "orgAllowAgentRouting",
      op.auto_approve_internal_low_risk AS "orgAutoApproveInternalLowRisk",
      op.auto_approve_max_risk AS "orgAutoApproveMaxRisk",
      op.routing_rule AS "orgRoutingRule",
      op.approval_rule AS "orgApprovalRule",
      op.publishing_rule AS "orgPublishingRule",
      op.notification_rule AS "orgNotificationRule",
      cp.default_approver_role AS "clubDefaultApproverRole",
      cp.public_approver_role AS "clubPublicApproverRole",
      cp.medium_risk_approver_role AS "clubMediumRiskApproverRole",
      cp.allow_agent_routing AS "clubAllowAgentRouting",
      cp.auto_approve_internal_low_risk AS "clubAutoApproveInternalLowRisk",
      cp.auto_approve_max_risk AS "clubAutoApproveMaxRisk",
      cp.routing_rule AS "clubRoutingRule",
      cp.approval_rule AS "clubApprovalRule",
      cp.publishing_rule AS "clubPublishingRule",
      cp.notification_rule AS "clubNotificationRule"
    FROM clubs c
    LEFT JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN organization_workflow_policies op
      ON op.organization_id = c.organization_id
    LEFT JOIN club_workflow_policies cp
      ON cp.club_id = c.id
    WHERE c.id = $1
    LIMIT 1
    `,
    [clubId]
  );

  return result.rows[0] || null;
}

async function queryOrganizationPolicyRow(client, organizationSlug) {
  const result = await client.query(
    `
    SELECT
      o.id AS "organizationId",
      o.slug AS "organizationSlug",
      o.name AS "organizationName",
      op.default_approver_role AS "orgDefaultApproverRole",
      op.public_approver_role AS "orgPublicApproverRole",
      op.medium_risk_approver_role AS "orgMediumRiskApproverRole",
      op.allow_agent_routing AS "orgAllowAgentRouting",
      op.auto_approve_internal_low_risk AS "orgAutoApproveInternalLowRisk",
      op.auto_approve_max_risk AS "orgAutoApproveMaxRisk",
      op.routing_rule AS "orgRoutingRule",
      op.approval_rule AS "orgApprovalRule",
      op.publishing_rule AS "orgPublishingRule",
      op.notification_rule AS "orgNotificationRule"
    FROM organizations o
    LEFT JOIN organization_workflow_policies op
      ON op.organization_id = o.id
    WHERE o.slug = $1
    LIMIT 1
    `,
    [organizationSlug]
  );

  return result.rows[0] || null;
}

export async function loadWorkflowPolicyScope(pool, { scopeType, scopeSlug }) {
  const normalizedSlug = normalizeSlug(scopeSlug);

  if (!normalizedSlug) {
    return { found: false };
  }

  if (scopeType === "club") {
    return buildClubPolicyResponse(await queryClubPolicyRow(pool, normalizedSlug));
  }

  return buildOrganizationPolicyResponse(
    await queryOrganizationPolicyRow(pool, normalizedSlug)
  );
}

export async function loadEffectiveNotificationRuleForClubId(pool, clubId) {
  const normalizedClubId = String(clubId || "").trim();

  if (!normalizedClubId) {
    return {};
  }

  const row = await queryClubPolicyRowById(pool, normalizedClubId);
  if (!row) {
    return defaultWorkflowPolicy.notificationRule;
  }

  return buildClubPolicyResponse(row).effectivePolicy.notificationRule || {};
}

export async function loadEffectiveApprovalRuleForClubId(pool, clubId) {
  const normalizedClubId = String(clubId || "").trim();

  if (!normalizedClubId) {
    return {};
  }

  const row = await queryClubPolicyRowById(pool, normalizedClubId);
  if (!row) {
    return defaultWorkflowPolicy.approvalRule;
  }

  return buildClubPolicyResponse(row).effectivePolicy.approvalRule || {};
}

export async function loadOrganizationDirectory(pool, organizationSlug) {
  const organizationRow = await queryOrganizationPolicyRow(pool, organizationSlug);

  if (!organizationRow) {
    return { found: false };
  }

  const clubsResult = await pool.query(
    `
    SELECT id, slug, name
    FROM clubs
    WHERE organization_id = $1
    ORDER BY name ASC, created_at ASC
    `,
    [organizationRow.organizationId]
  );

  const adminsResult = await pool.query(
    `
    SELECT
      om.role,
      u.email,
      u.full_name AS "fullName"
    FROM organization_memberships om
    JOIN users u ON u.id = om.user_id
    WHERE om.organization_id = $1
    ORDER BY
      CASE WHEN om.role = 'organization_admin' THEN 0 ELSE 1 END,
      om.created_at ASC
    `,
    [organizationRow.organizationId]
  );

  return {
    found: true,
    organization: {
      id: organizationRow.organizationId,
      slug: organizationRow.organizationSlug,
      name: organizationRow.organizationName
    },
    clubs: clubsResult.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name
    })),
    admins: adminsResult.rows.map((row) => ({
      role: row.role,
      email: row.email,
      fullName: row.fullName
    }))
  };
}

async function authorizeWorkflowPolicyActor(
  client,
  { scopeType, row, actorEmail }
) {
  const normalizedEmail = String(actorEmail || "").trim();
  const actor = await client.query(
    `SELECT id, email FROM users WHERE email = $1`,
    [normalizedEmail]
  );

  if (!actor.rowCount) {
    return {
      ok: false,
      status: 404,
      error: `Unknown actorEmail: ${actorEmail}`
    };
  }

  if (scopeType === "club") {
    const membership = await client.query(
      `
      SELECT role
      FROM memberships
      WHERE club_id = $1
        AND user_id = $2
        AND role = ANY($3::membership_role[])
      ORDER BY
        CASE WHEN role = 'club_admin' THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 1
      `,
      [row.club.id, actor.rows[0].id, clubPolicyManagerRoles]
    );

    if (!membership.rowCount) {
      return {
        ok: false,
        status: 403,
        error: "Only club reviewers or club admins can manage club workflow policies"
      };
    }

    return { ok: true, actor: actor.rows[0], actorRole: membership.rows[0].role };
  }

  const membership = await client.query(
    `
    SELECT role
    FROM organization_memberships
    WHERE organization_id = $1
      AND user_id = $2
      AND role = ANY($3::organization_membership_role[])
    ORDER BY
      CASE WHEN role = 'organization_admin' THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT 1
    `,
    [row.organization.id, actor.rows[0].id, organizationPolicyManagerRoles]
  );

  if (!membership.rowCount) {
    return {
      ok: false,
      status: 403,
      error: "Only organization admins or ops can manage organization workflow policies"
    };
  }

  return { ok: true, actor: actor.rows[0], actorRole: membership.rows[0].role };
}

function applyPatchValue(currentValue, patch, key) {
  return Object.hasOwn(patch, key) ? patch[key] : currentValue;
}

export async function updateWorkflowPolicyScope(
  client,
  { scopeType, scopeSlug, actorEmail, patch }
) {
  const current = await loadWorkflowPolicyScope(client, { scopeType, scopeSlug });

  if (!current.found) {
    return { found: false };
  }

  const authorization = await authorizeWorkflowPolicyActor(client, {
    scopeType,
    row: current,
    actorEmail
  });

  if (!authorization.ok) {
    return { found: true, ...authorization };
  }

  if (scopeType === "club") {
    const currentClubPolicy = current.clubPolicy || {};
    const nextPolicy = {
      defaultApproverRole: applyPatchValue(
        currentClubPolicy.defaultApproverRole ?? null,
        patch,
        "defaultApproverRole"
      ),
      publicApproverRole: applyPatchValue(
        currentClubPolicy.publicApproverRole ?? null,
        patch,
        "publicApproverRole"
      ),
      mediumRiskApproverRole: applyPatchValue(
        currentClubPolicy.mediumRiskApproverRole ?? null,
        patch,
        "mediumRiskApproverRole"
      ),
      allowAgentRouting: applyPatchValue(
        currentClubPolicy.allowAgentRouting ?? null,
        patch,
        "allowAgentRouting"
      ),
      autoApproveInternalLowRisk: applyPatchValue(
        currentClubPolicy.autoApproveInternalLowRisk ?? null,
        patch,
        "autoApproveInternalLowRisk"
      ),
      autoApproveMaxRisk: applyPatchValue(
        currentClubPolicy.autoApproveMaxRisk ?? null,
        patch,
        "autoApproveMaxRisk"
      ),
      routingRule: applyPatchValue(
        currentClubPolicy.routingRule ?? null,
        patch,
        "routingRule"
      ),
      approvalRule: applyPatchValue(
        currentClubPolicy.approvalRule ?? null,
        patch,
        "approvalRule"
      ),
      publishingRule: applyPatchValue(
        currentClubPolicy.publishingRule ?? null,
        patch,
        "publishingRule"
      ),
      notificationRule: applyPatchValue(
        currentClubPolicy.notificationRule ?? null,
        patch,
        "notificationRule"
      )
    };

    await client.query(
      `
      INSERT INTO club_workflow_policies (
        club_id,
        default_approver_role,
        public_approver_role,
        medium_risk_approver_role,
        allow_agent_routing,
        auto_approve_internal_low_risk,
        auto_approve_max_risk,
        routing_rule,
        approval_rule,
        publishing_rule,
        notification_rule,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, NOW())
      ON CONFLICT (club_id) DO UPDATE SET
        default_approver_role = EXCLUDED.default_approver_role,
        public_approver_role = EXCLUDED.public_approver_role,
        medium_risk_approver_role = EXCLUDED.medium_risk_approver_role,
        allow_agent_routing = EXCLUDED.allow_agent_routing,
        auto_approve_internal_low_risk = EXCLUDED.auto_approve_internal_low_risk,
        auto_approve_max_risk = EXCLUDED.auto_approve_max_risk,
        routing_rule = EXCLUDED.routing_rule,
        approval_rule = EXCLUDED.approval_rule,
        publishing_rule = EXCLUDED.publishing_rule,
        notification_rule = EXCLUDED.notification_rule,
        updated_at = NOW()
      `,
      [
        current.club.id,
        nextPolicy.defaultApproverRole,
        nextPolicy.publicApproverRole,
        nextPolicy.mediumRiskApproverRole,
        nextPolicy.allowAgentRouting,
        nextPolicy.autoApproveInternalLowRisk,
        nextPolicy.autoApproveMaxRisk,
        JSON.stringify(nextPolicy.routingRule || {}),
        JSON.stringify(nextPolicy.approvalRule || {}),
        JSON.stringify(nextPolicy.publishingRule || {}),
        JSON.stringify(nextPolicy.notificationRule || {})
      ]
    );
  } else {
    const currentOrganizationPolicy = current.organizationPolicy || defaultWorkflowPolicy;
    const nextPolicy = {
      defaultApproverRole: applyPatchValue(
        currentOrganizationPolicy.defaultApproverRole,
        patch,
        "defaultApproverRole"
      ),
      publicApproverRole: applyPatchValue(
        currentOrganizationPolicy.publicApproverRole,
        patch,
        "publicApproverRole"
      ),
      mediumRiskApproverRole: applyPatchValue(
        currentOrganizationPolicy.mediumRiskApproverRole,
        patch,
        "mediumRiskApproverRole"
      ),
      allowAgentRouting: applyPatchValue(
        currentOrganizationPolicy.allowAgentRouting,
        patch,
        "allowAgentRouting"
      ),
      autoApproveInternalLowRisk: applyPatchValue(
        currentOrganizationPolicy.autoApproveInternalLowRisk,
        patch,
        "autoApproveInternalLowRisk"
      ),
      autoApproveMaxRisk: applyPatchValue(
        currentOrganizationPolicy.autoApproveMaxRisk,
        patch,
        "autoApproveMaxRisk"
      ),
      routingRule: applyPatchValue(
        currentOrganizationPolicy.routingRule,
        patch,
        "routingRule"
      ),
      approvalRule: applyPatchValue(
        currentOrganizationPolicy.approvalRule,
        patch,
        "approvalRule"
      ),
      publishingRule: applyPatchValue(
        currentOrganizationPolicy.publishingRule,
        patch,
        "publishingRule"
      ),
      notificationRule: applyPatchValue(
        currentOrganizationPolicy.notificationRule,
        patch,
        "notificationRule"
      )
    };

    await client.query(
      `
      INSERT INTO organization_workflow_policies (
        organization_id,
        default_approver_role,
        public_approver_role,
        medium_risk_approver_role,
        allow_agent_routing,
        auto_approve_internal_low_risk,
        auto_approve_max_risk,
        routing_rule,
        approval_rule,
        publishing_rule,
        notification_rule,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, NOW())
      ON CONFLICT (organization_id) DO UPDATE SET
        default_approver_role = EXCLUDED.default_approver_role,
        public_approver_role = EXCLUDED.public_approver_role,
        medium_risk_approver_role = EXCLUDED.medium_risk_approver_role,
        allow_agent_routing = EXCLUDED.allow_agent_routing,
        auto_approve_internal_low_risk = EXCLUDED.auto_approve_internal_low_risk,
        auto_approve_max_risk = EXCLUDED.auto_approve_max_risk,
        routing_rule = EXCLUDED.routing_rule,
        approval_rule = EXCLUDED.approval_rule,
        publishing_rule = EXCLUDED.publishing_rule,
        notification_rule = EXCLUDED.notification_rule,
        updated_at = NOW()
      `,
      [
        current.organization.id,
        nextPolicy.defaultApproverRole,
        nextPolicy.publicApproverRole,
        nextPolicy.mediumRiskApproverRole,
        nextPolicy.allowAgentRouting,
        nextPolicy.autoApproveInternalLowRisk,
        nextPolicy.autoApproveMaxRisk,
        JSON.stringify(nextPolicy.routingRule || {}),
        JSON.stringify(nextPolicy.approvalRule || {}),
        JSON.stringify(nextPolicy.publishingRule || {}),
        JSON.stringify(nextPolicy.notificationRule || {})
      ]
    );
  }

  return loadWorkflowPolicyScope(client, { scopeType, scopeSlug });
}
