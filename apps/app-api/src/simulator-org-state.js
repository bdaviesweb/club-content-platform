import { getSimulatedPilotSeed } from "./bootstrap.js";
import { getPool, withTransaction } from "./db.js";
import { loadOrganizationDirectory, loadWorkflowPolicyScope } from "./workflow-policies.js";

const simulatorOrgPolicy = {
  defaultApproverRole: "team_manager",
  publicApproverRole: "club_comms",
  mediumRiskApproverRole: "club_comms",
  allowAgentRouting: true,
  autoApproveInternalLowRisk: true,
  autoApproveMaxRisk: 0.35,
  autoApprovalRule: { allowedContentTypes: ["photo"] },
  routingRule: { contentTypeApprovers: { video: "club_admin" } },
  approvalRule: {
    requireSecondApprovalForPublic: true,
    secondApproverRole: "club_admin",
    secondApprovalContentTypes: ["video"]
  },
  publishingRule: {
    visibilityDestinations: {
      internal: ["internal_feed"],
      public: ["internal_feed"]
    }
  },
  notificationRule: { email: true, push: true }
};

const simulatorClubPolicy = {
  defaultApproverRole: "team_manager",
  publicApproverRole: "club_comms",
  mediumRiskApproverRole: "club_comms",
  allowAgentRouting: true,
  autoApproveInternalLowRisk: false,
  autoApproveMaxRisk: 0.35,
  autoApprovalRule: { allowedContentTypes: ["photo"] },
  routingRule: { contentTypeApprovers: { video: "team_manager" } },
  approvalRule: { requireSecondApprovalForPublic: false },
  publishingRule: null,
  notificationRule: { email: false, push: false }
};

const safeSimulatorResetSeed = {
  organizationSlug: "north-river-youth-sports",
  clubSlug: "north-river-soccer-club",
  teamSlug: "u13-girls-blue"
};

function assertSafeSimulatorReset(state, env = process.env) {
  const customResetAllowed =
    String(env.ALLOW_CUSTOM_SIMULATOR_ORG_RESET || "").trim() === "1";
  if (customResetAllowed) {
    return;
  }

  const matchesDefaultSeed =
    state.seed.organizationSlug === safeSimulatorResetSeed.organizationSlug &&
    state.seed.slug === safeSimulatorResetSeed.clubSlug &&
    state.seed.teamSlug === safeSimulatorResetSeed.teamSlug;
  if (!matchesDefaultSeed) {
    throw new Error(
      "Refusing to reset simulator organization for custom slugs without ALLOW_CUSTOM_SIMULATOR_ORG_RESET=1."
    );
  }
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])])
    );
  }

  return value;
}

function isEqual(a, b) {
  return JSON.stringify(sortJson(a)) === JSON.stringify(sortJson(b));
}

function assertRows(actualRows, expectedRows) {
  return isEqual(actualRows, expectedRows);
}

function sortMembershipRows(rows) {
  return [...rows].sort((left, right) =>
    left.email.localeCompare(right.email) || left.role.localeCompare(right.role)
  );
}

function canonicalizePolicy(policy, { treatEmptyAsNull = false } = {}) {
  return {
    defaultApproverRole: policy.defaultApproverRole ?? null,
    publicApproverRole: policy.publicApproverRole ?? null,
    mediumRiskApproverRole: policy.mediumRiskApproverRole ?? null,
    allowAgentRouting:
      policy.allowAgentRouting === null || policy.allowAgentRouting === undefined
        ? null
        : Boolean(policy.allowAgentRouting),
    autoApproveInternalLowRisk:
      policy.autoApproveInternalLowRisk === null ||
      policy.autoApproveInternalLowRisk === undefined
        ? null
        : Boolean(policy.autoApproveInternalLowRisk),
    autoApproveMaxRisk:
      policy.autoApproveMaxRisk === null || policy.autoApproveMaxRisk === undefined
        ? null
        : Number(policy.autoApproveMaxRisk),
    autoApprovalRule: policy.autoApprovalRule || {},
    routingRule: policy.routingRule || {},
    approvalRule: policy.approvalRule || {},
    publishingRule:
      treatEmptyAsNull && !policy.publishingRule ? null : policy.publishingRule || {},
    notificationRule: policy.notificationRule || {}
  };
}

export function getSimulatorOrganizationState(env = process.env) {
  const seed = getSimulatedPilotSeed(env);

  return {
    seed,
    organizationPolicy: canonicalizePolicy(simulatorOrgPolicy),
    clubPolicy: canonicalizePolicy(simulatorClubPolicy, { treatEmptyAsNull: true }),
    memberships: [
      { email: seed.clubAdminEmail, role: "club_admin" },
      { email: seed.approverEmail, role: "club_comms" },
      { email: seed.submitterEmail, role: "submitter_coach" },
      { email: seed.teamManagerEmail, role: "team_manager" }
    ],
    organizationMembers: [
      {
        email: seed.organizationAdminEmail,
        role: "organization_admin"
      }
    ],
    publishingDestination: {
      destinationType: "internal_feed",
      name: "Internal Club Feed",
      config: { mode: "internal" }
    }
  };
}

async function upsertUser(client, { email, name }) {
  const result = await client.query(
    `
    INSERT INTO users (email, full_name)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id
    `,
    [email, name]
  );

  return result.rows[0].id;
}

export async function repairSimulatorOrganizationStateWithClient(
  client,
  env = process.env
) {
  const state = getSimulatorOrganizationState(env);
  assertSafeSimulatorReset(state, env);

  await client.query(
    `
    INSERT INTO organizations (slug, name)
    VALUES ($1, $2)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    `,
    [state.seed.organizationSlug, state.seed.organizationName]
  );

  const organizationIdResult = await client.query(
    `SELECT id FROM organizations WHERE slug = $1 LIMIT 1`,
    [state.seed.organizationSlug]
  );
  const organizationId = organizationIdResult.rows[0]?.id;

  await client.query(
    `
    INSERT INTO clubs (organization_id, slug, name)
    VALUES ($1, $2, $3)
    ON CONFLICT (slug) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      name = EXCLUDED.name
    `,
    [organizationId, state.seed.slug, state.seed.name]
  );

  const clubIdResult = await client.query(
    `SELECT id FROM clubs WHERE slug = $1 LIMIT 1`,
    [state.seed.slug]
  );
  const clubId = clubIdResult.rows[0]?.id;

  await client.query(`DELETE FROM clubs WHERE organization_id = $1 AND slug <> $2`, [
    organizationId,
    state.seed.slug
  ]);
  await client.query(`DELETE FROM teams WHERE club_id = $1 AND slug <> $2`, [
    clubId,
    state.seed.teamSlug
  ]);
  await client.query(`DELETE FROM memberships WHERE club_id = $1`, [clubId]);
  await client.query(`DELETE FROM organization_memberships WHERE organization_id = $1`, [
    organizationId
  ]);
  await client.query(`DELETE FROM publishing_destinations WHERE club_id = $1`, [clubId]);

  const teamResult = await client.query(
    `
    INSERT INTO teams (club_id, slug, name, age_group)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (club_id, slug) DO UPDATE SET
      name = EXCLUDED.name,
      age_group = EXCLUDED.age_group
    RETURNING id
    `,
    [clubId, state.seed.teamSlug, state.seed.teamName, state.seed.ageGroup]
  );
  const teamId = teamResult.rows[0]?.id;

  const submitterId = await upsertUser(client, {
    email: state.seed.submitterEmail,
    name: state.seed.submitterName
  });
  const commsId = await upsertUser(client, {
    email: state.seed.approverEmail,
    name: state.seed.approverName
  });
  const adminId = await upsertUser(client, {
    email: state.seed.clubAdminEmail,
    name: state.seed.clubAdminName
  });
  const teamManagerId = await upsertUser(client, {
    email: state.seed.teamManagerEmail,
    name: state.seed.teamManagerName
  });
  const orgAdminId = await upsertUser(client, {
    email: state.seed.organizationAdminEmail,
    name: state.seed.organizationAdminName
  });

  await client.query(
    `
    INSERT INTO memberships (club_id, team_id, user_id, role)
    VALUES
      ($1, $2, $3, 'submitter_coach'),
      ($1, $2, $4, 'club_comms'),
      ($1, $2, $5, 'club_admin'),
      ($1, $2, $6, 'team_manager')
    ON CONFLICT DO NOTHING
    `,
    [clubId, teamId, submitterId, commsId, adminId, teamManagerId]
  );

  await client.query(
    `
    INSERT INTO organization_memberships (organization_id, user_id, role)
    VALUES ($1, $2, 'organization_admin')
    ON CONFLICT DO NOTHING
    `,
    [organizationId, orgAdminId]
  );

  await client.query(
    `
    INSERT INTO publishing_destinations (club_id, destination_type, name, config, is_active)
    VALUES ($1, $2, $3, $4::jsonb, TRUE)
    `,
    [
      clubId,
      state.publishingDestination.destinationType,
      state.publishingDestination.name,
      JSON.stringify(state.publishingDestination.config)
    ]
  );

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
        auto_approval_rule,
        routing_rule,
        approval_rule,
        publishing_rule,
        notification_rule
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb)
      ON CONFLICT (organization_id) DO UPDATE SET
        default_approver_role = EXCLUDED.default_approver_role,
        public_approver_role = EXCLUDED.public_approver_role,
        medium_risk_approver_role = EXCLUDED.medium_risk_approver_role,
        allow_agent_routing = EXCLUDED.allow_agent_routing,
        auto_approve_internal_low_risk = EXCLUDED.auto_approve_internal_low_risk,
        auto_approve_max_risk = EXCLUDED.auto_approve_max_risk,
        auto_approval_rule = EXCLUDED.auto_approval_rule,
        routing_rule = EXCLUDED.routing_rule,
        approval_rule = EXCLUDED.approval_rule,
        publishing_rule = EXCLUDED.publishing_rule,
        notification_rule = EXCLUDED.notification_rule
    `,
    [
      organizationId,
      state.organizationPolicy.defaultApproverRole,
      state.organizationPolicy.publicApproverRole,
      state.organizationPolicy.mediumRiskApproverRole,
      state.organizationPolicy.allowAgentRouting,
      state.organizationPolicy.autoApproveInternalLowRisk,
      state.organizationPolicy.autoApproveMaxRisk,
      JSON.stringify(state.organizationPolicy.autoApprovalRule),
      JSON.stringify(state.organizationPolicy.routingRule),
      JSON.stringify(state.organizationPolicy.approvalRule),
      JSON.stringify(state.organizationPolicy.publishingRule),
      JSON.stringify(state.organizationPolicy.notificationRule)
    ]
  );

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
        auto_approval_rule,
        routing_rule,
        approval_rule,
        publishing_rule,
        notification_rule
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb)
      ON CONFLICT (club_id) DO UPDATE SET
        default_approver_role = EXCLUDED.default_approver_role,
        public_approver_role = EXCLUDED.public_approver_role,
        medium_risk_approver_role = EXCLUDED.medium_risk_approver_role,
        allow_agent_routing = EXCLUDED.allow_agent_routing,
        auto_approve_internal_low_risk = EXCLUDED.auto_approve_internal_low_risk,
        auto_approve_max_risk = EXCLUDED.auto_approve_max_risk,
        auto_approval_rule = EXCLUDED.auto_approval_rule,
        routing_rule = EXCLUDED.routing_rule,
        approval_rule = EXCLUDED.approval_rule,
        publishing_rule = EXCLUDED.publishing_rule,
        notification_rule = EXCLUDED.notification_rule
    `,
    [
      clubId,
      state.clubPolicy.defaultApproverRole,
      state.clubPolicy.publicApproverRole,
      state.clubPolicy.mediumRiskApproverRole,
      state.clubPolicy.allowAgentRouting,
      state.clubPolicy.autoApproveInternalLowRisk,
      state.clubPolicy.autoApproveMaxRisk,
      JSON.stringify(state.clubPolicy.autoApprovalRule),
      JSON.stringify(state.clubPolicy.routingRule),
      JSON.stringify(state.clubPolicy.approvalRule),
      JSON.stringify(state.clubPolicy.publishingRule),
      JSON.stringify(state.clubPolicy.notificationRule)
    ]
  );
}

export async function repairSimulatorOrganizationState({ env = process.env } = {}) {
  await withTransaction(async (client) => {
    await repairSimulatorOrganizationStateWithClient(client, env);
  });
}

export async function validateSimulatorOrganizationState({
  env = process.env,
  pool = getPool()
} = {}) {
  const state = getSimulatorOrganizationState(env);
  const blockers = [];

  const organizationScope = await loadWorkflowPolicyScope(pool, {
    scopeType: "organization",
    scopeSlug: state.seed.organizationSlug
  });
  const clubScope = await loadWorkflowPolicyScope(pool, {
    scopeType: "club",
    scopeSlug: state.seed.slug
  });
  const organizationDirectory = await loadOrganizationDirectory(
    pool,
    state.seed.organizationSlug
  );
  const clubMemberships = await pool.query(
    `
    SELECT u.email, m.role
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.club_id = (SELECT id FROM clubs WHERE slug = $1)
      AND m.team_id = (SELECT id FROM teams WHERE club_id = (SELECT id FROM clubs WHERE slug = $1) AND slug = $2)
    ORDER BY u.email, m.role
    `,
    [state.seed.slug, state.seed.teamSlug]
  );
  const organizationMemberships = await pool.query(
    `
    SELECT u.email, om.role
    FROM organization_memberships om
    JOIN users u ON u.id = om.user_id
    WHERE om.organization_id = (SELECT id FROM organizations WHERE slug = $1)
    ORDER BY u.email, om.role
    `,
    [state.seed.organizationSlug]
  );

  if (!organizationScope.found) {
    blockers.push(`Organization ${state.seed.organizationSlug} is missing.`);
  }
  if (!clubScope.found) {
    blockers.push(`Club ${state.seed.slug} is missing.`);
  }
  if (!organizationDirectory.found) {
    blockers.push(`Organization directory for ${state.seed.organizationSlug} is missing.`);
  }

  const expectedOrgPolicy = state.organizationPolicy;
  const expectedClubPolicy = state.clubPolicy;

  if (!organizationScope.found || !isEqual(organizationScope.organizationPolicy, expectedOrgPolicy)) {
    blockers.push("Organization workflow policy does not match the simulator baseline.");
  }
  if (!clubScope.found || !isEqual(clubScope.clubPolicy, expectedClubPolicy)) {
    blockers.push("Club workflow policy does not match the simulator baseline.");
  }
  if (!assertRows(sortMembershipRows(clubMemberships.rows), sortMembershipRows(state.memberships))) {
    blockers.push("Club/team memberships do not match the simulator baseline.");
  }
  const organizationMembershipView = organizationMemberships.rows.map(({ email, role }) => ({
    email,
    role
  }));
  if (
    !assertRows(
      sortMembershipRows(organizationMembershipView),
      sortMembershipRows(state.organizationMembers)
    )
  ) {
    blockers.push("Organization memberships do not match the simulator baseline.");
  }
  if (organizationDirectory.clubs.length !== 1) {
    blockers.push(`Expected exactly one club in the simulator organization, found ${organizationDirectory.clubs.length}.`);
  }
  if (organizationDirectory.admins.length !== 1) {
    blockers.push(`Expected exactly one organization admin, found ${organizationDirectory.admins.length}.`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
    state: {
      organization: organizationScope.organization || null,
      club: clubScope.club || null,
      organizationPolicy: organizationScope.organizationPolicy || null,
      clubPolicy: clubScope.clubPolicy || null,
      effectivePolicy: clubScope.effectivePolicy || null,
      organizationDirectory
    }
  };
}
