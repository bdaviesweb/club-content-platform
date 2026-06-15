import { internalDestinationType } from "../../../packages/shared/src/index.js";
import { getClubSeed } from "./bootstrap.js";

function buildCheck(key, label, ok, detail) {
  return {
    key,
    label,
    ok: Boolean(ok),
    detail
  };
}

export function buildAppReadinessPayload({ seed, row = {}, env = process.env }) {
  const checks = [
    buildCheck("demo_club", "Demo club", row.club_ready, seed.slug),
    buildCheck("demo_team", "Demo team", row.team_ready, seed.teamSlug),
    buildCheck("submitter_user", "Submitter account", row.submitter_ready, seed.submitterEmail),
    buildCheck(
      "submitter_membership",
      "Submitter membership",
      row.submitter_membership_ready,
      "submitter_coach"
    ),
    buildCheck("reviewer_user", "Reviewer account", row.reviewer_ready, seed.approverEmail),
    buildCheck(
      "reviewer_membership",
      "Reviewer membership",
      row.reviewer_membership_ready,
      "club_comms"
    ),
    buildCheck("publishing_destination", "Internal feed destination", row.publishing_ready, internalDestinationType)
  ];

  const checkMap = Object.fromEntries(checks.map((check) => [check.key, check.ok]));
  const reviewReady = checkMap.demo_club && checkMap.demo_team && checkMap.reviewer_user && checkMap.reviewer_membership;
  const submitReady = checkMap.demo_club && checkMap.demo_team && checkMap.submitter_user && checkMap.submitter_membership;
  const publishingReady = checkMap.demo_club && checkMap.publishing_destination;
  const uploadConfigured = Boolean(
    env.S3_ENDPOINT ||
    env.S3_PUBLIC_BASE_URL ||
    (env.S3_ACCESS_KEY && env.S3_SECRET_KEY)
  );

  return {
    productName: env.PUBLIC_PRODUCT_NAME || "Club Content",
    environment: env.NODE_ENV || "development",
    demo: {
      clubSlug: seed.slug,
      teamSlug: seed.teamSlug,
      submitterEmail: seed.submitterEmail,
      reviewerEmail: seed.approverEmail
    },
    capabilities: {
      submissions: submitReady,
      review: reviewReady,
      publishing: publishingReady,
      mediaUploads: uploadConfigured,
      emailNotifications: Boolean(env.RESEND_API_KEY && env.NOTIFICATION_FROM_EMAIL),
      pushNotifications: String(env.PUSH_NOTIFICATIONS_ENABLED || "").toLowerCase() === "true"
    },
    checks
  };
}

export async function loadAppReadiness({ pool, env = process.env }) {
  const seed = getClubSeed(env);
  const result = await pool.query(
    `
    WITH seed AS (
      SELECT
        $1::text AS club_slug,
        $2::text AS team_slug,
        $3::text AS submitter_email,
        $4::text AS reviewer_email
    )
    SELECT
      c.id IS NOT NULL AS club_ready,
      t.id IS NOT NULL AS team_ready,
      submitter.id IS NOT NULL AS submitter_ready,
      submitter_membership.id IS NOT NULL AS submitter_membership_ready,
      reviewer.id IS NOT NULL AS reviewer_ready,
      reviewer_membership.id IS NOT NULL AS reviewer_membership_ready,
      EXISTS (
        SELECT 1
        FROM publishing_destinations pd
        WHERE pd.club_id = c.id
          AND pd.destination_type = $5
          AND pd.is_active = TRUE
      ) AS publishing_ready
    FROM seed
    LEFT JOIN clubs c ON c.slug = seed.club_slug
    LEFT JOIN teams t ON t.club_id = c.id AND t.slug = seed.team_slug
    LEFT JOIN users submitter ON submitter.email = seed.submitter_email
    LEFT JOIN memberships submitter_membership
      ON submitter_membership.club_id = c.id
      AND submitter_membership.team_id = t.id
      AND submitter_membership.user_id = submitter.id
      AND submitter_membership.role = 'submitter_coach'
    LEFT JOIN users reviewer ON reviewer.email = seed.reviewer_email
    LEFT JOIN memberships reviewer_membership
      ON reviewer_membership.club_id = c.id
      AND reviewer_membership.team_id = t.id
      AND reviewer_membership.user_id = reviewer.id
      AND reviewer_membership.role = 'club_comms'
    `,
    [
      seed.slug,
      seed.teamSlug,
      seed.submitterEmail,
      seed.approverEmail,
      internalDestinationType
    ]
  );

  return buildAppReadinessPayload({
    seed,
    row: result.rows[0] || {},
    env
  });
}
