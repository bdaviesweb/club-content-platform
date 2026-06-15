import { withTransaction } from "./db.js";
import { internalDestinationType } from "../../../packages/shared/src/index.js";
import { ensureBucket } from "./storage.js";

const defaultClubSeed = {
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
  });
}
