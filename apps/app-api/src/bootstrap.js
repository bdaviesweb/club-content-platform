import { withTransaction } from "./db.js";
import { internalDestinationType } from "../../../packages/shared/src/index.js";
import { ensureBucket } from "./storage.js";

const clubSeed = {
  slug: "demo-soccer-club",
  name: "Demo Soccer Club",
  teamSlug: "u14-girls",
  teamName: "U14 Girls",
  approverEmail: "comms@demo-club.local",
  approverName: "Club Comms",
  submitterEmail: "coach@demo-club.local",
  submitterName: "Demo Coach"
};

export async function ensureSeedData() {
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

    const approver = await client.query(
      `
      INSERT INTO users (email, full_name)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id
      `,
      [clubSeed.approverEmail, clubSeed.approverName]
    );

    const submitter = await client.query(
      `
      INSERT INTO users (email, full_name)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id
      `,
      [clubSeed.submitterEmail, clubSeed.submitterName]
    );

    await client.query(
      `
      INSERT INTO memberships (club_id, team_id, user_id, role)
      VALUES ($1, $2, $3, 'club_comms')
      ON CONFLICT DO NOTHING
      `,
      [clubId, teamId, approver.rows[0].id]
    );

    await client.query(
      `
      INSERT INTO memberships (club_id, team_id, user_id, role)
      VALUES ($1, $2, $3, 'submitter_coach')
      ON CONFLICT DO NOTHING
      `,
      [clubId, teamId, submitter.rows[0].id]
    );

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
