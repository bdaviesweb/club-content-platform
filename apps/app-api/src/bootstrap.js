import { withTransaction } from "./db.js";
import { internalDestinationType } from "../../../packages/shared/src/index.js";
import { ensureBucket } from "./storage.js";

const defaultClubSeed = {
  organizationSlug: "demo-sports-org",
  organizationName: "Demo Sports Organization",
  slug: "demo-soccer-club",
  name: "Demo Soccer Club",
  teamSlug: "u14-girls",
  teamName: "U14 Girls",
  approverEmail: "comms@demo-club.local",
  approverName: "Club Comms",
  submitterEmail: "coach@demo-club.local",
  submitterName: "Demo Coach"
};

export function getClubSeed(env = process.env) {
  return {
    organizationSlug:
      env.DEMO_ORGANIZATION_SLUG || defaultClubSeed.organizationSlug,
    organizationName:
      env.DEMO_ORGANIZATION_NAME || defaultClubSeed.organizationName,
    slug: env.DEMO_CLUB_SLUG || defaultClubSeed.slug,
    name: env.DEMO_CLUB_NAME || defaultClubSeed.name,
    teamSlug: env.DEMO_TEAM_SLUG || defaultClubSeed.teamSlug,
    teamName: env.DEMO_TEAM_NAME || defaultClubSeed.teamName,
    approverEmail:
      env.DEMO_REVIEWER_EMAIL ||
      env.DEMO_APPROVER_EMAIL ||
      defaultClubSeed.approverEmail,
    approverName:
      env.DEMO_REVIEWER_NAME ||
      env.DEMO_APPROVER_NAME ||
      defaultClubSeed.approverName,
    submitterEmail:
      env.DEMO_SUBMITTER_EMAIL ||
      env.EXPO_PUBLIC_SUBMITTER_EMAIL ||
      defaultClubSeed.submitterEmail,
    submitterName: env.DEMO_SUBMITTER_NAME || defaultClubSeed.submitterName
  };
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
    ADD COLUMN IF NOT EXISTS publishing_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS notification_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
}

export async function ensureSeedData() {
  const clubSeed = getClubSeed();

  await ensureBucket();

  await withTransaction(async (client) => {
    await ensureWorkflowPolicyTables(client);

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
      [clubId, clubSeed.teamSlug, clubSeed.teamName, "U14"]
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
      role: "submitter_coach",
      email: clubSeed.submitterEmail,
      name: clubSeed.submitterName
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
        auto_approve_max_risk
      )
      VALUES ($1, 'team_manager', 'club_comms', 'club_comms', TRUE, FALSE, 0.35)
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
        auto_approve_max_risk
      )
      VALUES ($1, 'team_manager', 'club_comms', 'club_comms', TRUE, FALSE, 0.35)
      ON CONFLICT (club_id) DO NOTHING
      `,
      [clubId]
    );
  });
}
