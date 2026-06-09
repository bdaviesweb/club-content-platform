import http from "node:http";
import { ensureSeedData } from "./bootstrap.js";
import { withTransaction, getPool } from "./db.js";
import {
  readJson,
  readText,
  sendJson,
  sendMethodNotAllowed,
  sendNotFound
} from "./http.js";
import { Webhook } from "svix";
import {
  createAndDeliverNotification,
  submissionEvents
} from "../../../packages/shared/src/index.js";
import { buildPublicObjectUrl, createUploadPlan } from "./storage.js";
import {
  allowedEditableRoles,
  canEditMembershipRole,
  canViewMemberships,
  describeMembershipChange,
  membershipKey,
  normalizeMembershipDraft,
  normalizeMembershipRecord,
  pickHighestMembershipRole
} from "./club-memberships.js";

const port = Number(process.env.API_PORT || 4000);
const publicAppName = process.env.PUBLIC_PRODUCT_NAME || "Club Content";
const supportEmail = process.env.SUPPORT_EMAIL || "support@davmn.net";
const companyName = process.env.COMPANY_NAME || "Club Content";
const resendApiKey = process.env.RESEND_API_KEY || "";
const notificationFromEmail = process.env.NOTIFICATION_FROM_EMAIL || "";
const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET || "";
const resendWebhookEndpointPath = "/webhooks/resend";
const resendWebhookEvents = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed"
];
const pushNotificationsEnabled =
  String(process.env.PUSH_NOTIFICATIONS_ENABLED || "").toLowerCase() === "true";
const pushProvider = process.env.PUSH_PROVIDER || "expo";
const pushProjectId = process.env.PUSH_PROJECT_ID || "";
const defaultClubPolicy = {
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

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || "localhost"}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8"
  });
  res.end(html);
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value) {
  return normalizeOptionalString(value)?.toLowerCase() || null;
}

function mergeClubPolicy(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    ...defaultClubPolicy,
    ...config,
    routing: {
      ...defaultClubPolicy.routing,
      ...(config.routing || {})
    },
    review: {
      ...defaultClubPolicy.review,
      ...(config.review || {})
    },
    channels: Array.isArray(config.channels)
      ? config.channels
      : defaultClubPolicy.channels
  };
}

async function loadClubMembershipContext(client, clubSlug, actorEmail) {
  const normalizedActorEmail = normalizeEmail(actorEmail);
  if (!normalizedActorEmail) {
    return null;
  }

  const clubResult = await client.query(
    `
    SELECT id, slug, name
    FROM clubs
    WHERE slug = $1
    LIMIT 1
    `,
    [clubSlug]
  );

  if (!clubResult.rowCount) {
    return null;
  }

  const club = clubResult.rows[0];
  const actorResult = await client.query(
    `
    SELECT
      u.id AS user_id,
      u.email,
      u.full_name,
      m.role
    FROM memberships m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.club_id = $1
      AND lower(u.email) = $2
    `,
    [club.id, normalizedActorEmail]
  );

  if (!actorResult.rowCount) {
    return { club, actorEmail: normalizedActorEmail, actorRole: null, actorUserId: null };
  }

  const actorRole = pickHighestMembershipRole(actorResult.rows.map((row) => row.role));

  return {
    club,
    actorEmail: normalizedActorEmail,
    actorUserId: actorResult.rows[0].user_id,
    actorFullName: actorResult.rows[0].full_name,
    actorRole
  };
}

async function loadClubMembershipRows(client, clubId) {
  const result = await client.query(
    `
    SELECT
      m.id AS membership_id,
      m.team_id,
      m.user_id,
      m.role,
      m.created_at,
      c.slug AS club_slug,
      c.name AS club_name,
      t.slug AS team_slug,
      t.name AS team_name,
      u.email,
      u.full_name
    FROM memberships m
    INNER JOIN clubs c ON c.id = m.club_id
    INNER JOIN users u ON u.id = m.user_id
    LEFT JOIN teams t ON t.id = m.team_id
    WHERE m.club_id = $1
    ORDER BY m.role, u.full_name, u.email, COALESCE(t.name, '')
    `,
    [clubId]
  );

  return result.rows.map(normalizeMembershipRecord);
}

async function loadClubMembershipHistory(client, clubId) {
  const result = await client.query(
    `
    SELECT
      al.id,
      al.action,
      al.metadata,
      al.created_at,
      u.full_name AS actor_name,
      u.email AS actor_email
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.actor_user_id
    WHERE al.entity_type = 'club'
      AND al.entity_id = $1
      AND al.action = 'membership_roster_updated'
    ORDER BY al.created_at DESC
    LIMIT 20
    `,
    [clubId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorName: row.actor_name || "Unknown",
    actorEmail: row.actor_email || null,
    createdAt: row.created_at,
    metadata: row.metadata || {}
  }));
}

async function ensureClubMembershipUser(client, { email, fullName }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("email is required");
  }

  const safeName = normalizeOptionalString(fullName) || normalizedEmail;

  const result = await client.query(
    `
    INSERT INTO users (email, full_name)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE
    SET full_name = EXCLUDED.full_name
    RETURNING id
    `,
    [normalizedEmail, safeName]
  );

  return result.rows[0].id;
}

function maskPushToken(pushToken) {
  if (!pushToken) {
    return null;
  }

  if (pushToken.length <= 12) {
    return pushToken;
  }

  return `${pushToken.slice(0, 6)}...${pushToken.slice(-6)}`;
}

function enrichMediaAsset(item) {
  if (!item) {
    return item;
  }

  return {
    ...item,
    previewUrl: buildPublicObjectUrl(item.objectKey)
  };
}

function enrichMediaCollection(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map(enrichMediaAsset);
}

function renderPublicPage({ title, eyebrow, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #eef5ff;
        --panel: rgba(255, 255, 255, 0.94);
        --ink: #102238;
        --muted: #5a6b7e;
        --accent: #0c6ddf;
        --border: #d7e4f2;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(12, 109, 223, 0.16), transparent 28%),
          linear-gradient(180deg, #f8fbff 0%, var(--bg) 100%);
      }
      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 48px 20px 72px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 18px 44px rgba(16, 34, 56, 0.08);
      }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--accent);
        font-size: 0.9rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(2rem, 5vw, 3.2rem);
        line-height: 1.04;
      }
      p, li {
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.65;
      }
      h2 {
        margin-top: 26px;
        margin-bottom: 8px;
        font-size: 1.1rem;
      }
      a { color: var(--accent); }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: #f0f5fb;
        border-radius: 6px;
        padding: 2px 6px;
      }
      footer {
        margin-top: 18px;
        font-size: 0.95rem;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="panel">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        ${body}
      </div>
    </main>
  </body>
</html>`;
}

function handleSupportPage(res) {
  sendHtml(
    res,
    200,
    renderPublicPage({
      title: `${publicAppName} Support`,
      eyebrow: publicAppName,
      body: `
        <p>${escapeHtml(publicAppName)} helps workspaces, coaches, families, and team staff collect updates and move content through a structured review flow.</p>
        <h2>Contact Support</h2>
        <p>Email <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a> for help with account issues, alerts, beta access, or app problems.</p>
        <h2>What To Include</h2>
        <ul>
          <li>Your device model and app version</li>
          <li>What you were trying to submit or review</li>
          <li>Any screenshots or error messages</li>
        </ul>
        <h2>Response Scope</h2>
        <p>Support requests are handled for install issues, uploads, approvals, publishing questions, and account-related problems.</p>
        <footer>${escapeHtml(companyName)} support page</footer>
      `
    })
  );
}

function handlePrivacyPage(res) {
  sendHtml(
    res,
    200,
    renderPublicPage({
      title: `${publicAppName} Privacy Policy`,
      eyebrow: "Privacy Policy",
      body: `
        <p>${escapeHtml(publicAppName)} supports content submissions, approvals, publishing workflows, and related mobile app usage.</p>
        <h2>Information We Use</h2>
        <p>We may process limited account, device, and usage information needed to operate the app, deliver notifications, improve reliability, and support users.</p>
        <h2>How Information Is Used</h2>
        <p>Information is used to provide core app features, monitor service health, support workflow operations, and improve product quality.</p>
        <h2>Third-Party Services</h2>
        <p>The app may rely on third-party infrastructure providers for storage, notifications, analytics, and delivery of core workflow features.</p>
        <h2>Data Sales</h2>
        <p>We do not sell personal information.</p>
        <h2>Contact</h2>
        <p>For privacy questions, contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
        <footer>${escapeHtml(companyName)} privacy policy</footer>
      `
    })
  );
}

async function handleCreateSubmission(req, res) {
  const body = await readJson(req);
  const {
    clubSlug,
    teamSlug,
    submitterEmail,
    contentType,
    rawText,
    selectedChannels = [],
    visibilityTarget = "internal",
    media = []
  } = body;

  if (!clubSlug || !submitterEmail || !contentType) {
    sendJson(res, 400, {
      error: "clubSlug, submitterEmail, and contentType are required"
    });
    return;
  }

  const submission = await withTransaction(async (client) => {
    const clubResult = await client.query(
      `SELECT id FROM clubs WHERE slug = $1`,
      [clubSlug]
    );

    if (!clubResult.rowCount) {
      throw new Error(`Unknown clubSlug: ${clubSlug}`);
    }

    const userResult = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [submitterEmail]
    );

    if (!userResult.rowCount) {
      throw new Error(`Unknown submitterEmail: ${submitterEmail}`);
    }

    let teamId = null;
    if (teamSlug) {
      const teamResult = await client.query(
        `SELECT id FROM teams WHERE club_id = $1 AND slug = $2`,
        [clubResult.rows[0].id, teamSlug]
      );

      if (!teamResult.rowCount) {
        throw new Error(`Unknown teamSlug: ${teamSlug}`);
      }

      teamId = teamResult.rows[0].id;
    }

    const submissionResult = await client.query(
      `
      INSERT INTO submissions (
        club_id,
        team_id,
        submitted_by_user_id,
        content_type,
        raw_text,
        selected_channels,
        visibility_target,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'received')
      RETURNING *
      `,
      [
        clubResult.rows[0].id,
        teamId,
        userResult.rows[0].id,
        contentType,
        rawText || null,
        JSON.stringify(Array.isArray(selectedChannels) ? selectedChannels : []),
        visibilityTarget
      ]
    );

    const createdSubmission = submissionResult.rows[0];

    for (const item of media) {
      await client.query(
        `
        INSERT INTO submission_media (
          submission_id,
          object_key,
          media_type,
          mime_type,
          width,
          height,
          duration_seconds,
          checksum_sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          createdSubmission.id,
          item.objectKey,
          item.mediaType,
          item.mimeType,
          item.width || null,
          item.height || null,
          item.durationSeconds || null,
          item.checksumSha256 || null
        ]
      );
    }

    await client.query(
      `
      INSERT INTO submission_events (submission_id, event_name, payload)
      VALUES ($1, $2, $3::jsonb)
      `,
      [
        createdSubmission.id,
        submissionEvents.created,
        JSON.stringify({
          contentType,
          visibilityTarget,
          selectedChannels: Array.isArray(selectedChannels) ? selectedChannels : [],
          mediaCount: media.length
        })
      ]
    );

    return createdSubmission;
  });

  sendJson(res, 201, { submission });
}

async function handleCreateUploadPlan(req, res) {
  const body = await readJson(req);
  const { clubSlug, files } = body;

  if (!clubSlug || !Array.isArray(files) || !files.length) {
    sendJson(res, 400, {
      error: "clubSlug and a non-empty files array are required"
    });
    return;
  }

  const plans = await Promise.all(
    files.map(async (file) =>
      createUploadPlan({
        clubSlug,
        mediaType: file.mediaType,
        mimeType: file.mimeType,
        filename: file.filename
      })
    )
  );

  sendJson(res, 200, { uploads: plans });
}

async function handleGetSubmission(res, submissionId) {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      s.*,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', sm.id,
            'objectKey', sm.object_key,
            'mediaType', sm.media_type,
            'mimeType', sm.mime_type
          )
        ) FILTER (WHERE sm.id IS NOT NULL),
        '[]'::json
      ) AS media
    FROM submissions s
    LEFT JOIN submission_media sm ON sm.submission_id = s.id
    WHERE s.id = $1
    GROUP BY s.id
    `,
    [submissionId]
  );

  if (!result.rowCount) {
    sendNotFound(res);
    return;
  }

  result.rows[0].media = enrichMediaCollection(result.rows[0].media);

  const [latestReviewRun, latestApprovalRequest, publishedPost] = await Promise.all([
    pool.query(
      `
      SELECT
        rr.id,
        rr.agent_name AS "agentName",
        rr.model,
        rr.result_status AS "resultStatus",
        rr.confidence,
        rr.summary,
        rr.created_at AS "createdAt"
      FROM review_runs rr
      WHERE rr.submission_id = $1
      ORDER BY rr.created_at DESC
      LIMIT 1
      `,
      [submissionId]
    ),
    pool.query(
      `
      SELECT
        ar.id,
        ar.state,
        ar.approver_role AS "approverRole",
        ar.created_at AS "createdAt",
        ar.updated_at AS "updatedAt",
        u.full_name AS "approverName",
        (
          SELECT jsonb_build_object(
            'id', aa.id,
            'action', aa.action,
            'notes', aa.notes,
            'createdAt', aa.created_at,
            'actedByName', au.full_name,
            'reasonCode',
            (
              SELECT al.metadata->>'reasonCode'
              FROM audit_logs al
              WHERE al.entity_type = 'approval_request'
                AND al.entity_id = ar.id
                AND al.action = aa.action
              ORDER BY al.created_at DESC
              LIMIT 1
            )
          )
          FROM approval_actions aa
          JOIN users au ON au.id = aa.acted_by_user_id
          WHERE aa.approval_request_id = ar.id
          ORDER BY aa.created_at DESC
          LIMIT 1
        ) AS "latestAction"
      FROM approval_requests ar
      JOIN users u ON u.id = ar.approver_user_id
      WHERE ar.submission_id = $1
      ORDER BY ar.created_at DESC
      LIMIT 1
      `,
      [submissionId]
    ),
    pool.query(
      `
      SELECT
        pp.id,
        pp.external_post_id AS "externalPostId",
        pp.published_at AS "publishedAt",
        pd.name AS "destinationName",
        pd.destination_type AS "destinationType"
      FROM published_posts pp
      JOIN publishing_destinations pd ON pd.id = pp.destination_id
      WHERE pp.submission_id = $1
      ORDER BY pp.published_at DESC
      LIMIT 1
      `,
      [submissionId]
    )
  ]);

  sendJson(res, 200, {
    ...result.rows[0],
    latestReviewRun: latestReviewRun.rows[0] || null,
    latestApprovalRequest: latestApprovalRequest.rows[0] || null,
    publishedPost: publishedPost.rows[0] || null
  });
}

async function handleListSubmissions(res, query) {
  const submitterEmail = query.get("submitterEmail");
  const clubSlug = query.get("clubSlug");
  const teamSlug = query.get("teamSlug");
  const requestedLimit = Number(query.get("limit") || 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 25)
    : 10;

  if (!submitterEmail) {
    sendJson(res, 400, { error: "submitterEmail is required" });
    return;
  }

  const values = [submitterEmail];
  const filters = [`u.email = $1`];

  if (clubSlug) {
    values.push(clubSlug);
    filters.push(`c.slug = $${values.length}`);
  }

  if (teamSlug) {
    values.push(teamSlug);
    filters.push(`t.slug = $${values.length}`);
  }

  values.push(limit);

  const result = await getPool().query(
    `
    SELECT
      s.id,
      s.content_type,
      s.raw_text,
      s.selected_channels AS "selectedChannels",
      s.visibility_target,
      s.status,
      s.risk_score,
      s.created_at,
      c.slug AS club_slug,
      t.slug AS team_slug,
      COALESCE(COUNT(sm.id), 0) AS media_count
    FROM submissions s
    JOIN users u ON u.id = s.submitted_by_user_id
    JOIN clubs c ON c.id = s.club_id
    LEFT JOIN teams t ON t.id = s.team_id
    LEFT JOIN submission_media sm ON sm.submission_id = s.id
    WHERE ${filters.join(" AND ")}
    GROUP BY s.id, c.slug, t.slug
    ORDER BY s.created_at DESC
    LIMIT $${values.length}
    `,
    values
  );

  sendJson(res, 200, { items: result.rows });
}

async function handleResubmitSubmission(req, res, submissionId) {
  const body = await readJson(req);
  const submitterEmail = normalizeOptionalString(body.submitterEmail);
  const rawText = normalizeOptionalString(body.rawText);
  const selectedChannels = Array.isArray(body.selectedChannels) ? body.selectedChannels : null;
  const visibilityTarget = normalizeOptionalString(body.visibilityTarget);
  const media = Array.isArray(body.media) ? body.media : null;

  if (!submitterEmail) {
    sendJson(res, 400, { error: "submitterEmail is required" });
    return;
  }

  const result = await withTransaction(async (client) => {
    const submissionResult = await client.query(
      `
      SELECT s.*, u.email AS submitter_email
      FROM submissions s
      JOIN users u ON u.id = s.submitted_by_user_id
      WHERE s.id = $1
      FOR UPDATE
      `,
      [submissionId]
    );

    if (!submissionResult.rowCount) {
      return null;
    }

    const submission = submissionResult.rows[0];
    if (submission.submitter_email !== submitterEmail) {
      throw new Error("Only the original submitter can resubmit this item");
    }

    if (submission.status !== "needs_metadata") {
      throw new Error("Only items sent back for changes can be resubmitted");
    }

    const userResult = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [submitterEmail]
    );

    if (!userResult.rowCount) {
      throw new Error(`Unknown submitterEmail: ${submitterEmail}`);
    }

    await client.query(
      `
      UPDATE submissions
      SET raw_text = COALESCE($2, raw_text),
          selected_channels = COALESCE($3, selected_channels),
          visibility_target = COALESCE($4, visibility_target),
          status = 'received',
          risk_score = NULL,
          routing_decision = NULL,
          caption_draft = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        submissionId,
        rawText,
        selectedChannels ? JSON.stringify(selectedChannels) : null,
        visibilityTarget
      ]
    );

    if (media) {
      await client.query(
        `
        DELETE FROM submission_media
        WHERE submission_id = $1
        `,
        [submissionId]
      );

      for (const item of media) {
        await client.query(
          `
          INSERT INTO submission_media (
            submission_id,
            object_key,
            media_type,
            mime_type,
            width,
            height,
            duration_seconds,
            checksum_sha256
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            submissionId,
            item.objectKey,
            item.mediaType,
            item.mimeType,
            item.width || null,
            item.height || null,
            item.durationSeconds || null,
            item.checksumSha256 || null
          ]
        );
      }
    }

    await client.query(
      `
      INSERT INTO submission_events (submission_id, event_name, payload)
      VALUES ($1, $2, $3::jsonb)
      `,
      [
        submissionId,
        submissionEvents.created,
        JSON.stringify({
          resubmitted: true,
          submitterEmail,
          rawText: rawText || submission.raw_text || null,
          mediaCount: media ? media.length : undefined
        })
      ]
    );

    await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, entity_type, entity_id, action, metadata)
      VALUES ($1, 'submission', $2, 'resubmitted', $3::jsonb)
      `,
      [
        userResult.rows[0].id,
        submissionId,
        JSON.stringify({
          visibilityTarget: visibilityTarget || submission.visibility_target,
          selectedChannels: selectedChannels || submission.selected_channels || [],
          rawText: rawText || submission.raw_text || null
        })
      ]
    );

    return { id: submissionId, status: "received" };
  });

  if (!result) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, { submission: result });
}

async function handleGetClubWorkflowPolicy(res, clubSlug) {
  const result = await getPool().query(
    `
    SELECT
      c.slug AS club_slug,
      c.name AS club_name,
      p.policy_key,
      p.config,
      p.updated_at
    FROM clubs c
    LEFT JOIN club_workflow_policies p ON p.club_id = c.id
    WHERE c.slug = $1
    LIMIT 1
    `,
    [clubSlug]
  );

  if (!result.rowCount) {
    sendNotFound(res);
    return;
  }

  const row = result.rows[0];
  sendJson(res, 200, {
    clubSlug: row.club_slug,
    clubName: row.club_name,
    policyKey: row.policy_key || "default",
    config: mergeClubPolicy(row.config),
    updatedAt: row.updated_at || null
  });
}

async function handleUpdateClubWorkflowPolicy(req, res, clubSlug) {
  const body = await readJson(req);
  const policyKey = normalizeOptionalString(body.policyKey) || "default";
  const config = body.config && typeof body.config === "object" ? body.config : null;

  if (!config) {
    sendJson(res, 400, { error: "config is required" });
    return;
  }

  const result = await withTransaction(async (client) => {
    const clubResult = await client.query(
      `
      SELECT id, slug, name
      FROM clubs
      WHERE slug = $1
      LIMIT 1
      `,
      [clubSlug]
    );

    if (!clubResult.rowCount) {
      return null;
    }

    const club = clubResult.rows[0];
    const mergedConfig = mergeClubPolicy(config);

    const saved = await client.query(
      `
      INSERT INTO club_workflow_policies (club_id, policy_key, config)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (club_id) DO UPDATE
      SET policy_key = EXCLUDED.policy_key,
          config = EXCLUDED.config,
          updated_at = NOW()
      RETURNING updated_at
      `,
      [club.id, policyKey, JSON.stringify(mergedConfig)]
    );

    return {
      clubSlug: club.slug,
      clubName: club.name,
      policyKey,
      config: mergedConfig,
      updatedAt: saved.rows[0].updated_at
    };
  });

  if (!result) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, result);
}

async function handleGetClubMemberships(res, clubSlug, actorEmail) {
  if (!normalizeEmail(actorEmail)) {
    sendJson(res, 400, { error: "actorEmail is required" });
    return;
  }

  const result = await getPool().query(
    `
    SELECT id, slug, name
    FROM clubs
    WHERE slug = $1
    LIMIT 1
    `,
    [clubSlug]
  );

  if (!result.rowCount) {
    sendNotFound(res);
    return;
  }

  const club = result.rows[0];
  const access = await getPool().query(
    `
    SELECT
      u.id AS user_id,
      u.email,
      u.full_name,
      m.role
    FROM memberships m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.club_id = $1
      AND lower(u.email) = $2
    `,
    [club.id, normalizeEmail(actorEmail) || ""]
  );

  const actorRole = pickHighestMembershipRole(access.rows.map((row) => row.role));

  if (!canViewMemberships(actorRole)) {
    sendJson(res, 403, { error: "Membership settings are limited to club admins and club comms." });
    return;
  }

  const teams = await getPool().query(
    `
    SELECT id, slug, name, age_group
    FROM teams
    WHERE club_id = $1
    ORDER BY name ASC
    `,
    [club.id]
  );

  const memberships = await getPool().query(
    `
    SELECT
      m.id AS membership_id,
      m.team_id,
      m.user_id,
      m.role,
      m.created_at,
      c.slug AS club_slug,
      c.name AS club_name,
      t.slug AS team_slug,
      t.name AS team_name,
      u.email,
      u.full_name
    FROM memberships m
    INNER JOIN clubs c ON c.id = m.club_id
    INNER JOIN users u ON u.id = m.user_id
    LEFT JOIN teams t ON t.id = m.team_id
    WHERE m.club_id = $1
    ORDER BY m.role, u.full_name, u.email, COALESCE(t.name, '')
    `,
    [club.id]
  );
  const history = await loadClubMembershipHistory(getPool(), club.id);

  const actorView = {
    email: normalizeEmail(actorEmail),
    role: actorRole,
    canView: true,
    canEditAll: actorRole === "club_admin",
    editableRoles: allowedEditableRoles(actorRole)
  };

  sendJson(res, 200, {
    clubSlug: club.slug,
    clubName: club.name,
    actor: actorView,
    teams: [
      { id: null, slug: null, name: "Club-wide", ageGroup: null },
      ...teams.rows.map((team) => ({
        id: team.id,
        slug: team.slug,
        name: team.name,
        ageGroup: team.age_group || null
      }))
    ],
    memberships: memberships.rows.map(normalizeMembershipRecord),
    editableRoles: allowedEditableRoles(actorRole),
    history
  });
}

async function handleUpdateClubMemberships(req, res, clubSlug) {
  const body = await readJson(req);
  const actorEmail = normalizeEmail(body.actorEmail);
  const incomingRows = Array.isArray(body.memberships) ? body.memberships : [];

  if (!actorEmail) {
    sendJson(res, 400, { error: "actorEmail is required" });
    return;
  }

  const result = await withTransaction(async (client) => {
    const clubContext = await loadClubMembershipContext(client, clubSlug, actorEmail);

    if (!clubContext?.club) {
      return { status: 404, payload: { error: "Club not found" } };
    }

    if (!canViewMemberships(clubContext.actorRole)) {
      return {
        status: 403,
        payload: { error: "Membership settings are limited to club admins and club comms." }
      };
    }

    const editableRoles = allowedEditableRoles(clubContext.actorRole);
    const teamResult = await client.query(
      `
      SELECT id, slug, name, age_group
      FROM teams
      WHERE club_id = $1
      `,
      [clubContext.club.id]
    );
    const teamBySlug = new Map(teamResult.rows.map((team) => [team.slug, team]));

    const currentRows = await loadClubMembershipRows(client, clubContext.club.id);
    const currentEditableRows = currentRows.filter((row) => editableRoles.includes(row.role));

    const desiredRows = [];
    const seenKeys = new Set();

    for (const input of incomingRows) {
      const draft = normalizeMembershipDraft(input);
      if (!draft) {
        return {
          status: 400,
          payload: { error: "Each membership row needs email, fullName, and a valid role." }
        };
      }

      if (!canEditMembershipRole(clubContext.actorRole, draft.role)) {
        return {
          status: 403,
          payload: { error: `You cannot edit the ${draft.role} role.` }
        };
      }

      if (draft.teamSlug && !teamBySlug.has(draft.teamSlug)) {
        return {
          status: 400,
          payload: { error: `Unknown team slug: ${draft.teamSlug}` }
        };
      }

      const key = membershipKey(draft);
      if (seenKeys.has(key)) {
        return {
          status: 400,
          payload: { error: "Duplicate membership rows are not allowed." }
        };
      }
      seenKeys.add(key);

      desiredRows.push({
        ...draft,
        teamId: draft.teamSlug ? teamBySlug.get(draft.teamSlug).id : null,
        teamName: draft.teamSlug ? teamBySlug.get(draft.teamSlug).name : "Club-wide"
      });
    }

    const desiredKeys = new Set(desiredRows.map((row) => membershipKey(row)));
    const currentEditableByKey = new Map(
      currentEditableRows.map((row) => [membershipKey(row), row])
    );

    for (const row of currentEditableRows) {
      if (!desiredKeys.has(membershipKey(row))) {
        await client.query(
          `
          DELETE FROM memberships
          WHERE id = $1
          `,
          [row.membershipId]
        );
      }
    }

    for (const row of desiredRows) {
      const existing = currentEditableByKey.get(membershipKey(row));
      const userId = await ensureClubMembershipUser(client, {
        email: row.email,
        fullName: row.fullName
      });

      if (existing?.userId && existing.userId !== userId) {
        await client.query(
          `
          DELETE FROM memberships
          WHERE id = $1
          `,
          [existing.membershipId]
        );
      }

      await client.query(
        `
        INSERT INTO memberships (club_id, team_id, user_id, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        `,
        [clubContext.club.id, row.teamId, userId, row.role]
      );
    }

    const nextRows = await loadClubMembershipRows(client, clubContext.club.id);
    const nextEditableRows = nextRows.filter((row) => editableRoles.includes(row.role));
    const diff = describeMembershipChange(currentEditableRows, nextEditableRows);

    const audit = await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, entity_type, entity_id, action, metadata)
      VALUES ($1, 'club', $2, 'membership_roster_updated', $3::jsonb)
      RETURNING id, created_at
      `,
      [
        clubContext.actorUserId,
        clubContext.club.id,
        JSON.stringify({
          actorEmail,
          actorRole: clubContext.actorRole,
          diff,
          editableRoles
        })
      ]
    );

    return {
      status: 200,
      payload: {
        clubSlug: clubContext.club.slug,
        clubName: clubContext.club.name,
        actor: {
          email: actorEmail,
          role: clubContext.actorRole,
          canView: true,
          canEditAll: clubContext.actorRole === "club_admin",
          editableRoles
        },
        teams: [
          { id: null, slug: null, name: "Club-wide", ageGroup: null },
          ...teamResult.rows.map((team) => ({
            id: team.id,
            slug: team.slug,
            name: team.name,
            ageGroup: team.age_group || null
          }))
        ],
        memberships: nextRows,
        editableRoles,
        audit: audit.rows[0],
        diff,
        history: await loadClubMembershipHistory(client, clubContext.club.id)
      }
    };
  });

  if (!result) {
    sendNotFound(res);
    return;
  }

  sendJson(res, result.status, result.payload);
}

async function handleApprovalQueue(res) {
  const result = await getPool().query(
    `
    SELECT
      ar.id,
      ar.state,
      ar.created_at,
      s.id AS submission_id,
      s.status AS submission_status,
      s.raw_text,
      s.risk_score,
      u.full_name AS approver_name,
      rv.summary AS latest_review_summary
    FROM approval_requests ar
    JOIN submissions s ON s.id = ar.submission_id
    JOIN users u ON u.id = ar.approver_user_id
    LEFT JOIN LATERAL (
      SELECT summary
      FROM review_runs
      WHERE submission_id = s.id
      ORDER BY created_at DESC
      LIMIT 1
    ) rv ON TRUE
    WHERE ar.state = 'pending'
    ORDER BY ar.created_at ASC
    `
  );

  sendJson(res, 200, { items: result.rows });
}

async function handleApprovalRequestDetail(res, approvalRequestId) {
  const result = await getPool().query(
    `
    SELECT
      ar.id,
      ar.state,
      ar.approver_role,
      ar.created_at,
      ar.updated_at,
      s.id AS submission_id,
      s.status AS submission_status,
      s.content_type,
      s.raw_text,
      s.caption_draft,
      s.visibility_target,
      s.risk_score,
      s.routing_decision,
      su.full_name AS submitter_name,
      su.email AS submitter_email,
      au.full_name AS approver_name,
      au.email AS approver_email,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', sm.id,
            'objectKey', sm.object_key,
            'mediaType', sm.media_type,
            'mimeType', sm.mime_type
          )
        ) FILTER (WHERE sm.id IS NOT NULL),
        '[]'::json
      ) AS media,
      COALESCE(
        (
          SELECT json_agg(
            jsonb_build_object(
              'id', rr.id,
              'agentName', rr.agent_name,
              'model', rr.model,
              'resultStatus', rr.result_status,
              'confidence', rr.confidence,
              'summary', rr.summary,
              'createdAt', rr.created_at
            )
            ORDER BY rr.created_at DESC
          )
          FROM review_runs rr
          WHERE rr.submission_id = s.id
        ),
        '[]'::json
      ) AS review_runs,
      COALESCE(
        (
          SELECT json_agg(
            jsonb_build_object(
              'id', aa.id,
              'action', aa.action,
              'notes', aa.notes,
              'createdAt', aa.created_at,
              'actedByName', u.full_name,
              'reasonCode',
              (
                SELECT al.metadata->>'reasonCode'
                FROM audit_logs al
                WHERE al.entity_type = 'approval_request'
                  AND al.entity_id = ar.id
                  AND al.action = aa.action
                ORDER BY al.created_at DESC
                LIMIT 1
              )
            )
            ORDER BY aa.created_at DESC
          )
          FROM approval_actions aa
          JOIN users u ON u.id = aa.acted_by_user_id
          WHERE aa.approval_request_id = ar.id
        ),
        '[]'::json
      ) AS approval_actions
    FROM approval_requests ar
    JOIN submissions s ON s.id = ar.submission_id
    JOIN users su ON su.id = s.submitted_by_user_id
    JOIN users au ON au.id = ar.approver_user_id
    LEFT JOIN submission_media sm ON sm.submission_id = s.id
    WHERE ar.id = $1
    GROUP BY ar.id, s.id, su.id, au.id
    `,
    [approvalRequestId]
  );

  if (!result.rowCount) {
    sendNotFound(res);
    return;
  }

  result.rows[0].media = enrichMediaCollection(result.rows[0].media);

  sendJson(res, 200, result.rows[0]);
}

async function handleApprovalAction(req, res, approvalRequestId) {
  const body = await readJson(req);
  const { action, actedByEmail, notes, reasonCode } = body;

  if (!action || !actedByEmail) {
    sendJson(res, 400, { error: "action and actedByEmail are required" });
    return;
  }

  const normalizedAction = String(action).toLowerCase();
  if (!["approve", "reject", "request_changes"].includes(normalizedAction)) {
    sendJson(res, 400, { error: "Invalid action" });
    return;
  }

  const result = await withTransaction(async (client) => {
    const approvalRequest = await client.query(
      `
      SELECT ar.*, s.club_id, s.id AS submission_id, s.submitted_by_user_id
      FROM approval_requests ar
      JOIN submissions s ON s.id = ar.submission_id
      WHERE ar.id = $1
      FOR UPDATE
      `,
      [approvalRequestId]
    );

    if (!approvalRequest.rowCount) {
      return null;
    }

    const actor = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [actedByEmail]
    );

    if (!actor.rowCount) {
      throw new Error(`Unknown actedByEmail: ${actedByEmail}`);
    }

    const stateMap = {
      approve: "approved",
      reject: "rejected",
      request_changes: "changes_requested"
    };

    const submissionStatusMap = {
      approve: "approved_internal",
      reject: "rejected",
      request_changes: "needs_metadata"
    };

    await client.query(
      `
      UPDATE approval_requests
      SET state = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [approvalRequestId, stateMap[normalizedAction]]
    );

    await client.query(
      `
      INSERT INTO approval_actions (
        approval_request_id,
        acted_by_user_id,
        action,
        notes
      )
      VALUES ($1, $2, $3, $4)
      `,
      [approvalRequestId, actor.rows[0].id, normalizedAction, notes || null]
    );

    await client.query(
      `
      UPDATE submissions
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [approvalRequest.rows[0].submission_id, submissionStatusMap[normalizedAction]]
    );

    if (normalizedAction === "approve") {
      await client.query(
        `
        INSERT INTO submission_events (submission_id, event_name, payload)
        VALUES ($1, $2, $3::jsonb)
        `,
        [
          approvalRequest.rows[0].submission_id,
          submissionEvents.approved,
          JSON.stringify({ approvalRequestId })
        ]
      );
    }

    await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, entity_type, entity_id, action, metadata)
      VALUES ($1, 'approval_request', $2, $3, $4::jsonb)
      `,
      [
        actor.rows[0].id,
        approvalRequestId,
        normalizedAction,
        JSON.stringify({ notes: notes || null, reasonCode: reasonCode || null })
      ]
    );

    if (normalizedAction !== "approve") {
      await createAndDeliverNotification(client, {
        userId: approvalRequest.rows[0].submitted_by_user_id,
        type:
          normalizedAction === "reject"
            ? "submission_rejected"
            : "submission_changes_requested",
        payload: {
          submissionId: approvalRequest.rows[0].submission_id,
          approvalRequestId,
          action: normalizedAction,
          notes: notes || null,
          reasonCode: reasonCode || null
        },
        actorUserId: actor.rows[0].id
      });
    }

    return { approvalRequestId, action: normalizedAction };
  });

  if (!result) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, result);
}

async function handleInternalFeed(res) {
  const result = await getPool().query(
    `
    SELECT
      pp.id,
      pp.published_at,
      s.id AS submission_id,
      s.raw_text,
      s.caption_draft,
      s.content_type,
      s.visibility_target,
      s.risk_score,
      pd.name AS destination_name,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'objectKey', sm.object_key,
            'mediaType', sm.media_type,
            'mimeType', sm.mime_type
          )
        ) FILTER (WHERE sm.id IS NOT NULL),
        '[]'::json
      ) AS media
    FROM published_posts pp
    JOIN submissions s ON s.id = pp.submission_id
    JOIN publishing_destinations pd ON pd.id = pp.destination_id
    LEFT JOIN submission_media sm ON sm.submission_id = s.id
    GROUP BY pp.id, s.id, pd.id
    ORDER BY pp.published_at DESC
    LIMIT 50
    `
  );

  sendJson(res, 200, { items: result.rows });
}

async function handleNotifications(res, searchParams) {
  const userEmail = searchParams.get("userEmail");
  const requestedLimit = Number(searchParams.get("limit") || 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 25)
    : 10;

  if (!userEmail) {
    sendJson(res, 400, { error: "userEmail is required" });
    return;
  }

  const result = await getPool().query(
    `
    SELECT
      n.id,
      n.type,
      n.payload,
      n.read_at AS "readAt",
      n.created_at AS "createdAt",
      latest_delivery.metadata->>'webhookType' AS "deliveryStatus",
      latest_delivery.metadata->>'emailId' AS "deliveryProviderId",
      latest_delivery.created_at AS "deliveryUpdatedAt"
    FROM notifications n
    JOIN users u ON u.id = n.user_id
    LEFT JOIN LATERAL (
      SELECT metadata, created_at
      FROM audit_logs
      WHERE entity_type = 'notification'
        AND entity_id = n.id
        AND action LIKE 'notification.email.webhook.%'
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_delivery ON TRUE
    WHERE u.email = $1
    ORDER BY n.created_at DESC
    LIMIT $2
    `,
    [userEmail, limit]
  );

  sendJson(res, 200, { items: result.rows });
}

async function handleRegisterPushToken(req, res) {
  const body = await readJson(req);
  const userEmail = normalizeOptionalString(body.userEmail);
  const installationId = normalizeOptionalString(body.installationId);
  const pushToken = normalizeOptionalString(body.pushToken);
  const platform = normalizeOptionalString(body.platform);
  const provider = normalizeOptionalString(body.provider) || pushProvider;
  const appId = normalizeOptionalString(body.appId);
  const environment = normalizeOptionalString(body.environment);
  const deviceLabel = normalizeOptionalString(body.deviceLabel);
  const enabled = body.enabled !== false;

  if (!userEmail || !installationId) {
    sendJson(res, 400, {
      error: "userEmail and installationId are required"
    });
    return;
  }

  if (enabled && !pushToken) {
    sendJson(res, 400, {
      error: "pushToken is required when enabled is true"
    });
    return;
  }

  const result = await withTransaction(async (client) => {
    const userResult = await client.query(
      `SELECT id, email FROM users WHERE email = $1`,
      [userEmail]
    );

    if (!userResult.rowCount) {
      return null;
    }

    const userId = userResult.rows[0].id;
    const action = enabled ? "push_token.upserted" : "push_token.revoked";
    const metadata = {
      push: {
        provider,
        installationId,
        pushToken: enabled ? pushToken : null,
        platform,
        appId,
        environment,
        deviceLabel,
        enabled
      }
    };

    await client.query(
      `
      INSERT INTO audit_logs (entity_type, entity_id, action, metadata)
      VALUES ('user', $1, $2, $3::jsonb)
      `,
      [userId, action, JSON.stringify(metadata)]
    );

    return {
      userId,
      userEmail: userResult.rows[0].email,
      provider,
      installationId,
      platform,
      appId,
      environment,
      deviceLabel,
      enabled,
      pushToken: enabled ? pushToken : null,
      tokenPreview: enabled ? maskPushToken(pushToken) : null
    };
  });

  if (!result) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, { registration: result });
}

async function handleListPushTokens(res, searchParams) {
  const userEmail = normalizeOptionalString(searchParams.get("userEmail"));

  if (!userEmail) {
    sendJson(res, 400, { error: "userEmail is required" });
    return;
  }

  const result = await getPool().query(
    `
    WITH latest_push_state AS (
      SELECT DISTINCT ON (u.id, al.metadata->'push'->>'installationId')
        u.id AS user_id,
        u.email AS user_email,
        al.action,
        al.created_at,
        al.metadata->'push'->>'provider' AS provider,
        al.metadata->'push'->>'installationId' AS installation_id,
        al.metadata->'push'->>'pushToken' AS push_token,
        al.metadata->'push'->>'platform' AS platform,
        al.metadata->'push'->>'appId' AS app_id,
        al.metadata->'push'->>'environment' AS environment,
        al.metadata->'push'->>'deviceLabel' AS device_label,
        COALESCE((al.metadata->'push'->>'enabled')::boolean, false) AS enabled
      FROM audit_logs al
      JOIN users u ON u.id = al.entity_id
      WHERE al.entity_type = 'user'
        AND al.action IN ('push_token.upserted', 'push_token.revoked')
        AND u.email = $1
        AND COALESCE(al.metadata->'push'->>'installationId', '') <> ''
      ORDER BY u.id, al.metadata->'push'->>'installationId', al.created_at DESC
    )
    SELECT
      user_id AS "userId",
      user_email AS "userEmail",
      provider,
      installation_id AS "installationId",
      push_token AS "pushToken",
      platform,
      app_id AS "appId",
      environment,
      device_label AS "deviceLabel",
      enabled,
      created_at AS "updatedAt"
    FROM latest_push_state
    WHERE enabled = TRUE
    ORDER BY created_at DESC
    `
    ,
    [userEmail]
  );

  sendJson(res, 200, {
    items: result.rows.map((row) => ({
      ...row,
      tokenPreview: maskPushToken(row.pushToken)
    }))
  });
}

function handleNotificationDeliveryStatus(res) {
  sendJson(res, 200, {
    email: {
      provider: resendApiKey ? "resend" : "log-only",
      enabled: Boolean(resendApiKey && notificationFromEmail),
      fromEmailConfigured: Boolean(notificationFromEmail),
      supportEmail,
      webhook: {
        endpointPath: resendWebhookEndpointPath,
        secretConfigured: Boolean(resendWebhookSecret),
        subscribedEvents: resendWebhookEvents
      }
    },
    push: {
      provider: pushProvider,
      enabled: pushNotificationsEnabled,
      projectIdConfigured: Boolean(pushProjectId),
      projectId: pushProjectId || null,
      registrationEndpoint: "/push-tokens"
    }
  });
}

function normalizeWebhookAction(type) {
  return String(type || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

async function handleResendWebhook(req, res) {
  const rawBody = await readText(req);

  if (!rawBody) {
    sendJson(res, 400, { error: "Webhook body is required" });
    return;
  }

  let event;
  let verified = false;

  if (resendWebhookSecret) {
    const svixHeaders = {
      "svix-id": req.headers["svix-id"],
      "svix-timestamp": req.headers["svix-timestamp"],
      "svix-signature": req.headers["svix-signature"]
    };

    try {
      event = new Webhook(resendWebhookSecret).verify(rawBody, svixHeaders);
      verified = true;
    } catch (error) {
      sendJson(res, 400, {
        error: "Invalid webhook signature",
        detail: error instanceof Error ? error.message : "signature_verification_failed"
      });
      return;
    }
  } else {
    event = JSON.parse(rawBody);
  }

  const webhookType = event?.type || "unknown";
  const emailId = event?.data?.email_id || null;
  const normalizedAction = normalizeWebhookAction(webhookType);
  const recipientEmail = Array.isArray(event?.data?.to)
    ? event.data.to[0] || null
    : event?.data?.to || null;

  const result = await withTransaction(async (client) => {
    let matchedNotificationId = null;

    if (emailId) {
      const match = await client.query(
        `
        SELECT entity_id AS "notificationId"
        FROM audit_logs
        WHERE entity_type = 'notification'
          AND action = 'notification.email.delivered'
          AND metadata->'delivery'->>'providerId' = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [emailId]
      );

      matchedNotificationId = match.rowCount ? match.rows[0].notificationId : null;
    }

    await client.query(
      `
      INSERT INTO audit_logs (entity_type, entity_id, action, metadata)
      VALUES ($1, $2, $3, $4::jsonb)
      `,
      [
        matchedNotificationId ? 'notification' : 'notification_webhook',
        matchedNotificationId,
        `notification.email.webhook.${normalizedAction}`,
        JSON.stringify({
          verified,
          webhookType,
          emailId,
          recipientEmail,
          createdAt: event?.created_at || null,
          data: event?.data || {},
          matchedNotificationId
        })
      ]
    );

    return { matchedNotificationId };
  });

  sendJson(res, 200, {
    received: true,
    verified,
    webhookType,
    matchedNotificationId: result.matchedNotificationId,
    emailId
  });
}

async function handleMarkNotificationRead(req, res, notificationId) {
  const body = await readJson(req);
  const userEmail = body.userEmail;

  if (!userEmail) {
    sendJson(res, 400, { error: "userEmail is required" });
    return;
  }

  const result = await getPool().query(
    `
    UPDATE notifications n
    SET read_at = COALESCE(n.read_at, NOW())
    FROM users u
    WHERE n.user_id = u.id
      AND n.id = $1
      AND u.email = $2
    RETURNING n.id, n.read_at AS "readAt"
    `,
    [notificationId, userEmail]
  );

  if (!result.rowCount) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, result.rows[0]);
}

async function handleWorkflowEvents(res, searchParams) {
  const status = searchParams.get("status") || "failed";
  const where =
    status === "failed"
      ? "WHERE processed_at IS NOT NULL AND processing_error IS NOT NULL"
      : status === "pending"
        ? "WHERE processed_at IS NULL"
        : "";

  const result = await getPool().query(
    `
    SELECT
      se.id,
      se.submission_id,
      se.event_name,
      se.payload,
      se.processed_at,
      se.processing_error,
      se.created_at,
      s.status AS submission_status,
      s.raw_text,
      s.caption_draft
    FROM submission_events se
    LEFT JOIN submissions s ON s.id = se.submission_id
    ${where}
    ORDER BY se.created_at DESC
    LIMIT 100
    `
  );

  sendJson(res, 200, { items: result.rows });
}

async function handleRetryWorkflowEvent(req, res, eventId) {
  const body = await readJson(req);
  const { actorEmail, notes } = body;

  if (!actorEmail) {
    sendJson(res, 400, { error: "actorEmail is required" });
    return;
  }

  const result = await withTransaction(async (client) => {
    const actor = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [actorEmail]
    );

    if (!actor.rowCount) {
      throw new Error(`Unknown actorEmail: ${actorEmail}`);
    }

    const eventResult = await client.query(
      `
      SELECT *
      FROM submission_events
      WHERE id = $1
      FOR UPDATE
      `,
      [eventId]
    );

    if (!eventResult.rowCount) {
      return null;
    }

    await client.query(
      `
      UPDATE submission_events
      SET processed_at = NULL, processing_error = NULL
      WHERE id = $1
      `,
      [eventId]
    );

    await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, entity_type, entity_id, action, metadata)
      VALUES ($1, 'submission_event', $2, 'retry_requested', $3::jsonb)
      `,
      [
        actor.rows[0].id,
        eventId,
        JSON.stringify({
          notes: notes || null,
          previousError: eventResult.rows[0].processing_error || null
        })
      ]
    );

    return {
      eventId,
      eventName: eventResult.rows[0].event_name,
      submissionId: eventResult.rows[0].submission_id,
      reset: true
    };
  });

  if (!result) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = parseUrl(req);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
        "access-control-allow-headers": "content-type, authorization, svix-id, svix-timestamp, svix-signature",
        vary: "Origin"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { service: "app-api", status: "ok" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/support") {
      handleSupportPage(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/privacy") {
      handlePrivacyPage(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/submissions") {
      await handleCreateSubmission(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/uploads/sign") {
      await handleCreateUploadPlan(req, res);
      return;
    }

    if (req.method === "GET" && /^\/clubs\/[^/]+\/workflow-policy$/.test(url.pathname)) {
      await handleGetClubWorkflowPolicy(res, decodeURIComponent(url.pathname.split("/")[2]));
      return;
    }

    if (req.method === "GET" && /^\/clubs\/[^/]+\/memberships$/.test(url.pathname)) {
      await handleGetClubMemberships(
        res,
        decodeURIComponent(url.pathname.split("/")[2]),
        url.searchParams.get("actorEmail")
      );
      return;
    }

    if (req.method === "PUT" && /^\/clubs\/[^/]+\/workflow-policy$/.test(url.pathname)) {
      await handleUpdateClubWorkflowPolicy(req, res, decodeURIComponent(url.pathname.split("/")[2]));
      return;
    }

    if (req.method === "PUT" && /^\/clubs\/[^/]+\/memberships$/.test(url.pathname)) {
      await handleUpdateClubMemberships(req, res, decodeURIComponent(url.pathname.split("/")[2]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/submissions") {
      await handleListSubmissions(res, url.searchParams);
      return;
    }

    if (req.method === "GET" && /^\/submissions\/[^/]+$/.test(url.pathname)) {
      await handleGetSubmission(res, url.pathname.split("/")[2]);
      return;
    }

    if (
      req.method === "POST" &&
      /^\/submissions\/[^/]+\/resubmit$/.test(url.pathname)
    ) {
      await handleResubmitSubmission(req, res, url.pathname.split("/")[2]);
      return;
    }

    if (req.method === "GET" && url.pathname === "/approvals/queue") {
      await handleApprovalQueue(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/notifications") {
      await handleNotifications(res, url.searchParams);
      return;
    }

    if (req.method === "GET" && url.pathname === "/push-tokens") {
      await handleListPushTokens(res, url.searchParams);
      return;
    }

    if (req.method === "POST" && url.pathname === "/push-tokens") {
      await handleRegisterPushToken(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/notification-delivery/status") {
      handleNotificationDeliveryStatus(res);
      return;
    }

    if (req.method === "POST" && url.pathname === resendWebhookEndpointPath) {
      await handleResendWebhook(req, res);
      return;
    }

    if (
      req.method === "GET" &&
      /^\/approval-requests\/[^/]+$/.test(url.pathname)
    ) {
      await handleApprovalRequestDetail(res, url.pathname.split("/")[2]);
      return;
    }

    if (
      req.method === "POST" &&
      /^\/notifications\/[^/]+\/read$/.test(url.pathname)
    ) {
      await handleMarkNotificationRead(req, res, url.pathname.split("/")[2]);
      return;
    }

    if (
      req.method === "POST" &&
      /^\/approval-requests\/[^/]+\/actions$/.test(url.pathname)
    ) {
      await handleApprovalAction(req, res, url.pathname.split("/")[2]);
      return;
    }

    if (req.method === "GET" && url.pathname === "/feed/internal") {
      await handleInternalFeed(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/workflow-events") {
      await handleWorkflowEvents(res, url.searchParams);
      return;
    }

    if (
      req.method === "POST" &&
      /^\/workflow-events\/[^/]+\/retry$/.test(url.pathname)
    ) {
      await handleRetryWorkflowEvent(req, res, url.pathname.split("/")[2]);
      return;
    }

    if (["GET", "POST"].includes(req.method)) {
      sendNotFound(res);
      return;
    }

    sendMethodNotAllowed(res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

await ensureSeedData();

server.listen(port, () => {
  console.log(`app-api listening on ${port}`);
});
