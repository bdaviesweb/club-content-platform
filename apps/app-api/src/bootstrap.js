import { withTransaction } from "./db.js";
import { internalDestinationType } from "../../../packages/shared/src/index.js";
import { ensureBucket } from "./storage.js";

const defaultDemoSeed = {
  organizationSlug: "demo-sports-org",
  organizationName: "Demo Sports Organization",
  organizationAdminEmail: "org-admin@demo-club.local",
  organizationAdminName: "Organization Admin",
  slug: "demo-soccer-club",
  name: "Demo Soccer Club",
  teamSlug: "u14-girls",
  teamName: "U14 Girls",
  ageGroup: "U14",
  approverEmail: "comms@demo-club.local",
  approverName: "Club Comms",
  submitterEmail: "coach@demo-club.local",
  submitterName: "Demo Coach",
  clubAdminEmail: "comms@demo-club.local",
  clubAdminName: "Club Comms",
  teamManagerEmail: "",
  teamManagerName: ""
};

const defaultSimulatedPilotSeed = {
  organizationSlug: "north-river-youth-sports",
  organizationName: "North River Youth Sports",
  organizationAdminEmail: "ops@northriverpilot.local",
  organizationAdminName: "Nora Operations",
  slug: "north-river-soccer-club",
  name: "North River Soccer Club",
  teamSlug: "u13-girls-blue",
  teamName: "U13 Girls Blue",
  ageGroup: "U13",
  approverEmail: "comms@northriverpilot.local",
  approverName: "Riley Comms",
  submitterEmail: "coach@northriverpilot.local",
  submitterName: "Avery Coach",
  clubAdminEmail: "admin@northriverpilot.local",
  clubAdminName: "Casey Admin",
  teamManagerEmail: "manager@northriverpilot.local",
  teamManagerName: "Jordan Manager"
};

function buildSeed(env, defaults, prefix, { allowExpoSubmitterFallback = false } = {}) {
  return {
    organizationSlug:
      env[`${prefix}_ORGANIZATION_SLUG`] || defaults.organizationSlug,
    organizationName:
      env[`${prefix}_ORGANIZATION_NAME`] || defaults.organizationName,
    organizationAdminEmail:
      env[`${prefix}_ORGANIZATION_ADMIN_EMAIL`] ||
      env[`${prefix}_ORG_ADMIN_EMAIL`] ||
      defaults.organizationAdminEmail,
    organizationAdminName:
      env[`${prefix}_ORGANIZATION_ADMIN_NAME`] ||
      env[`${prefix}_ORG_ADMIN_NAME`] ||
      defaults.organizationAdminName,
    slug: env[`${prefix}_CLUB_SLUG`] || defaults.slug,
    name: env[`${prefix}_CLUB_NAME`] || defaults.name,
    teamSlug: env[`${prefix}_TEAM_SLUG`] || defaults.teamSlug,
    teamName: env[`${prefix}_TEAM_NAME`] || defaults.teamName,
    ageGroup: env[`${prefix}_AGE_GROUP`] || defaults.ageGroup || "U14",
    approverEmail:
      env[`${prefix}_REVIEWER_EMAIL`] ||
      env[`${prefix}_APPROVER_EMAIL`] ||
      defaults.approverEmail,
    approverName:
      env[`${prefix}_REVIEWER_NAME`] ||
      env[`${prefix}_APPROVER_NAME`] ||
      defaults.approverName,
    submitterEmail:
      env[`${prefix}_SUBMITTER_EMAIL`] ||
      (allowExpoSubmitterFallback ? env.EXPO_PUBLIC_SUBMITTER_EMAIL : "") ||
      defaults.submitterEmail,
    submitterName: env[`${prefix}_SUBMITTER_NAME`] || defaults.submitterName,
    clubAdminEmail:
      env[`${prefix}_CLUB_ADMIN_EMAIL`] || defaults.clubAdminEmail || defaults.approverEmail,
    clubAdminName:
      env[`${prefix}_CLUB_ADMIN_NAME`] || defaults.clubAdminName || defaults.approverName,
    teamManagerEmail:
      env[`${prefix}_TEAM_MANAGER_EMAIL`] || defaults.teamManagerEmail || "",
    teamManagerName:
      env[`${prefix}_TEAM_MANAGER_NAME`] || defaults.teamManagerName || ""
  };
}

export function getClubSeed(env = process.env) {
  return buildSeed(env, defaultDemoSeed, "DEMO", {
    allowExpoSubmitterFallback: true
  });
}

export function getSimulatedPilotSeed(env = process.env) {
  return buildSeed(env, defaultSimulatedPilotSeed, "SIMULATED_PILOT");
}

export async function ensureWorkflowPolicyTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'organization_membership_role'
      ) THEN
        CREATE TYPE organization_membership_role AS ENUM (
          'organization_admin',
          'organization_ops'
        );
      END IF;
    END
    $$;
  `);

  await client.query(`
    ALTER TABLE clubs
    ADD COLUMN IF NOT EXISTS organization_id UUID
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'clubs_organization_id_fkey'
      ) THEN
        ALTER TABLE clubs
        ADD CONSTRAINT clubs_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_clubs_organization_id
    ON clubs(organization_id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS organization_workflow_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      default_approver_role membership_role,
      public_approver_role membership_role,
      medium_risk_approver_role membership_role,
      allow_agent_routing BOOLEAN NOT NULL DEFAULT TRUE,
      auto_approve_internal_low_risk BOOLEAN NOT NULL DEFAULT FALSE,
      auto_approve_max_risk NUMERIC(5,2),
      auto_approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      routing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      publishing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      notification_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE organization_workflow_policies
    ADD COLUMN IF NOT EXISTS default_approver_role membership_role,
    ADD COLUMN IF NOT EXISTS public_approver_role membership_role,
    ADD COLUMN IF NOT EXISTS medium_risk_approver_role membership_role,
    ADD COLUMN IF NOT EXISTS allow_agent_routing BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS auto_approve_internal_low_risk BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS auto_approve_max_risk NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS auto_approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS routing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS publishing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS notification_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS club_workflow_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id UUID NOT NULL UNIQUE REFERENCES clubs(id) ON DELETE CASCADE,
      default_approver_role membership_role,
      public_approver_role membership_role,
      medium_risk_approver_role membership_role,
      allow_agent_routing BOOLEAN,
      auto_approve_internal_low_risk BOOLEAN,
      auto_approve_max_risk NUMERIC(5,2),
      auto_approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      routing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      publishing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      notification_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE club_workflow_policies
    ADD COLUMN IF NOT EXISTS default_approver_role membership_role,
    ADD COLUMN IF NOT EXISTS public_approver_role membership_role,
    ADD COLUMN IF NOT EXISTS medium_risk_approver_role membership_role,
    ADD COLUMN IF NOT EXISTS allow_agent_routing BOOLEAN,
    ADD COLUMN IF NOT EXISTS auto_approve_internal_low_risk BOOLEAN,
    ADD COLUMN IF NOT EXISTS auto_approve_max_risk NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS auto_approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS routing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS publishing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS notification_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    ALTER TABLE approval_requests
    ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'primary'
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS organization_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role organization_membership_role NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, user_id, role)
    )
  `);

  await client.query(`
    ALTER TABLE organization_memberships
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_organization_memberships_org_user_role
    ON organization_memberships(organization_id, user_id, role)
  `);
}

async function ensureRoleMembership(client, { clubId, teamId, role, email, name }) {
  const currentMembership = await client.query(
    `
    SELECT memberships.id, memberships.user_id, users.email
    FROM memberships
    INNER JOIN users ON users.id = memberships.user_id
    WHERE memberships.club_id = $1
      AND memberships.team_id = $2
      AND memberships.role = $3
    ORDER BY memberships.created_at ASC
    LIMIT 1
    `,
    [clubId, teamId, role]
  );

  const targetUser = await client.query(
    `
    SELECT id
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [email]
  );

  let userId = targetUser.rows[0]?.id;

  if (currentMembership.rows[0] && (!userId || userId === currentMembership.rows[0].user_id)) {
    const updatedUser = await client.query(
      `
      UPDATE users
      SET email = $1,
          full_name = $2
      WHERE id = $3
      RETURNING id
      `,
      [email, name, currentMembership.rows[0].user_id]
    );

    userId = updatedUser.rows[0].id;
  } else if (userId) {
    await client.query(
      `
      UPDATE users
      SET full_name = $1
      WHERE id = $2
      `,
      [name, userId]
    );
  } else {
    const createdUser = await client.query(
      `
      INSERT INTO users (email, full_name)
      VALUES ($1, $2)
      RETURNING id
      `,
      [email, name]
    );

    userId = createdUser.rows[0].id;
  }

  await client.query(
    `
    DELETE FROM memberships
    WHERE club_id = $1
      AND team_id = $2
      AND role = $3
      AND user_id <> $4
    `,
    [clubId, teamId, role, userId]
  );

  await client.query(
    `
    INSERT INTO memberships (club_id, team_id, user_id, role)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
    `,
    [clubId, teamId, userId, role]
  );

  return userId;
}

async function ensureOrganizationMembership(
  client,
  { organizationId, role, email, name }
) {
  const targetUser = await client.query(
    `
    SELECT id
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [email]
  );

  let userId = targetUser.rows[0]?.id;

  if (userId) {
    await client.query(
      `
      UPDATE users
      SET full_name = $1
      WHERE id = $2
      `,
      [name, userId]
    );
  } else {
    const createdUser = await client.query(
      `
      INSERT INTO users (email, full_name)
      VALUES ($1, $2)
      RETURNING id
      `,
      [email, name]
    );

    userId = createdUser.rows[0].id;
  }

  await client.query(
    `
    INSERT INTO organization_memberships (organization_id, user_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
    `,
    [organizationId, userId, role]
  );

  return userId;
}

export async function ensureSeedData() {
  const seeds = [getClubSeed(), getSimulatedPilotSeed()];

  await ensureBucket();

  await withTransaction(async (client) => {
    await ensureWorkflowPolicyTables(client);

    for (const clubSeed of seeds) {
      const organization = await client.query(
        `
        INSERT INTO organizations (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        `,
        [clubSeed.organizationSlug, clubSeed.organizationName]
      );

      const organizationId = organization.rows[0].id;

      const club = await client.query(
        `
        INSERT INTO clubs (organization_id, slug, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          name = EXCLUDED.name
        RETURNING id
        `,
        [organizationId, clubSeed.slug, clubSeed.name]
      );

      const clubId = club.rows[0].id;

      const team = await client.query(
        `
        INSERT INTO teams (club_id, slug, name, age_group)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (club_id, slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        `,
        [clubId, clubSeed.teamSlug, clubSeed.teamName, clubSeed.ageGroup]
      );

      const teamId = team.rows[0].id;

      await ensureRoleMembership(client, {
        clubId,
        teamId,
        role: "club_comms",
        email: clubSeed.approverEmail,
        name: clubSeed.approverName
      });

      await ensureRoleMembership(client, {
        clubId,
        teamId,
        role: "club_admin",
        email: clubSeed.clubAdminEmail,
        name: clubSeed.clubAdminName
      });

      if (clubSeed.teamManagerEmail) {
        await ensureRoleMembership(client, {
          clubId,
          teamId,
          role: "team_manager",
          email: clubSeed.teamManagerEmail,
          name: clubSeed.teamManagerName
        });
      }

      await ensureRoleMembership(client, {
        clubId,
        teamId,
        role: "submitter_coach",
        email: clubSeed.submitterEmail,
        name: clubSeed.submitterName
      });

      await ensureOrganizationMembership(client, {
        organizationId,
        role: "organization_admin",
        email: clubSeed.organizationAdminEmail,
        name: clubSeed.organizationAdminName
      });

      await client.query(
        `
        INSERT INTO publishing_destinations (club_id, destination_type, name, config)
        SELECT $1, $2, 'Internal Club Feed', '{"mode":"internal"}'::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM publishing_destinations
          WHERE club_id = $1 AND destination_type = $2
        )
        `,
        [clubId, internalDestinationType]
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
        VALUES (
          $1,
          'team_manager',
          'club_comms',
          'club_comms',
          TRUE,
          TRUE,
          0.35,
          '{"allowedContentTypes":["photo"]}'::jsonb,
          '{"contentTypeApprovers":{"video":"club_admin"}}'::jsonb,
          '{"requireSecondApprovalForPublic":true,"secondApproverRole":"club_admin","secondApprovalContentTypes":["video"]}'::jsonb,
          '{"visibilityDestinations":{"internal":["internal_feed"],"public":["internal_feed"]}}'::jsonb,
          '{"email":true,"push":true}'::jsonb
        )
        ON CONFLICT (organization_id) DO NOTHING
        `,
        [organizationId]
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
        VALUES (
          $1,
          'team_manager',
          'club_comms',
          'club_comms',
          TRUE,
          FALSE,
          0.35,
          '{"allowedContentTypes":["photo"]}'::jsonb,
          '{"contentTypeApprovers":{"video":"team_manager"}}'::jsonb,
          '{"requireSecondApprovalForPublic":false}'::jsonb,
          '{}'::jsonb,
          '{"email":false,"push":false}'::jsonb
        )
        ON CONFLICT (club_id) DO NOTHING
        `,
        [clubId]
      );
    }
  });
}
