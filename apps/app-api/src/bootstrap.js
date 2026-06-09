import { withTransaction } from "./db.js";
import { internalDestinationType } from "../../../packages/shared/src/index.js";
import { ensureBucket } from "./storage.js";

const defaultClubSeed = {
  slug: "demo-workspace",
  name: "Demo Workspace",
  teamSlug: "content-team",
  teamName: "Content Team",
  adminEmail: "admin@demo-workspace.local",
  adminName: "Club Admin",
  approverEmail: "review@demo-workspace.local",
  approverName: "Review Lead",
  submitterEmail: "submitter@demo-workspace.local",
  submitterName: "Content Lead"
};

const defaultPolicyConfig = {
  channels: [
    { key: "instagram", label: "Instagram", favorite: true, allowed: true },
    { key: "facebook", label: "Facebook", favorite: true, allowed: true },
    { key: "team-feed", label: "Team Feed", favorite: true, allowed: true },
    { key: "website", label: "Website", favorite: false, allowed: true },
    { key: "newsletter", label: "Newsletter", favorite: false, allowed: true },
    { key: "x", label: "X", favorite: false, allowed: false, reviewRequired: true },
    { key: "tiktok", label: "TikTok", favorite: false, allowed: false, reviewRequired: true }
  ],
  routing: {
    publishMainFeedByDefault: true
  },
  review: {
    autoApproveMaxRisk: 0.2,
    alwaysReviewChannels: ["X", "TikTok"],
    alwaysReviewKeywords: [
      "injury",
      "hospital",
      "concussion",
      "address",
      "phone",
      "email",
      "contact"
    ],
    alwaysReviewContentTypes: ["video"]
  }
};

function getPolicyConfig() {
  try {
    if (process.env.DEMO_POLICY_CONFIG_JSON) {
      return JSON.parse(process.env.DEMO_POLICY_CONFIG_JSON);
    }
  } catch (_error) {
    // Fall back to the default config when the override is invalid.
  }

  return defaultPolicyConfig;
}

function getClubSeed() {
  return {
    slug: process.env.DEMO_CLUB_SLUG || defaultClubSeed.slug,
    name: process.env.DEMO_CLUB_NAME || defaultClubSeed.name,
    teamSlug: process.env.DEMO_TEAM_SLUG || defaultClubSeed.teamSlug,
    teamName: process.env.DEMO_TEAM_NAME || defaultClubSeed.teamName,
    adminEmail: process.env.DEMO_ADMIN_EMAIL || defaultClubSeed.adminEmail,
    adminName: process.env.DEMO_ADMIN_NAME || defaultClubSeed.adminName,
    approverEmail:
      process.env.DEMO_REVIEWER_EMAIL ||
      process.env.DEMO_APPROVER_EMAIL ||
      defaultClubSeed.approverEmail,
    approverName:
      process.env.DEMO_REVIEWER_NAME ||
      process.env.DEMO_APPROVER_NAME ||
      defaultClubSeed.approverName,
    submitterEmail:
      process.env.DEMO_SUBMITTER_EMAIL ||
      process.env.EXPO_PUBLIC_SUBMITTER_EMAIL ||
      defaultClubSeed.submitterEmail,
    submitterName: process.env.DEMO_SUBMITTER_NAME || defaultClubSeed.submitterName
  };
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
    const club = await client.query(
      `
      INSERT INTO clubs (slug, name)
      VALUES ($1, $2)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
      `,
      [clubSeed.slug, clubSeed.name]
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
      teamId: null,
      role: "club_admin",
      email: clubSeed.adminEmail,
      name: clubSeed.adminName
    });

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
      SELECT $1, $2, 'Internal Feed', '{"mode":"internal"}'::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM publishing_destinations
        WHERE club_id = $1 AND destination_type = $2
      )
      `,
      [clubId, internalDestinationType]
    );

    const destinationSeeds = [
      {
        destinationType: "instagram",
        name: "Instagram",
        config: {
          channelKey: "instagram",
          accountGroup: "instagram"
        }
      },
      {
        destinationType: "facebook",
        name: "Facebook",
        config: {
          channelKey: "facebook",
          accountGroup: "facebook"
        }
      },
      {
        destinationType: "team-feed",
        name: "Team Feed",
        config: {
          channelKey: "team-feed",
          accountGroup: "team-feed"
        }
      },
      {
        destinationType: "website",
        name: "Website",
        config: {
          channelKey: "website",
          accountGroup: "website"
        }
      },
      {
        destinationType: "newsletter",
        name: "Newsletter",
        config: {
          channelKey: "newsletter",
          accountGroup: "newsletter"
        }
      }
    ];

    for (const destination of destinationSeeds) {
      await client.query(
        `
        INSERT INTO publishing_destinations (club_id, destination_type, name, config)
        SELECT $1, $2, $3, $4::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM publishing_destinations
          WHERE club_id = $1 AND destination_type = $2 AND name = $3
        )
        `,
        [clubId, destination.destinationType, destination.name, JSON.stringify(destination.config)]
      );
    }

    try {
      const policyConfig = getPolicyConfig();
      await client.query(
        `
        INSERT INTO club_workflow_policies (club_id, policy_key, config)
        VALUES ($1, 'default', $2::jsonb)
        ON CONFLICT (club_id) DO UPDATE
        SET policy_key = EXCLUDED.policy_key,
            config = EXCLUDED.config,
            updated_at = NOW()
        `,
        [clubId, JSON.stringify(policyConfig)]
      );
    } catch (error) {
      if (error?.code !== "42P01") {
        throw error;
      }
      console.warn("club_workflow_policies seed skipped until the schema is migrated");
    }
  });
}
