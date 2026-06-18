import http from "node:http";
import { fileURLToPath } from "node:url";
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
import { loadAuthorizedApprovalActor } from "./approval-authorization.js";
import {
  buildPublicObjectUrl,
  createUploadPlan,
  getStoredObject,
  getStoredObjectMetadata,
  isDisplayPreviewMimeType,
  validateUploadRequest
} from "./storage.js";
import {
  maskPushToken,
  registerPushToken
} from "./push-tokens.js";
import { loadApprovalQueue } from "./approval-queue.js";
import { buildInternalFeedSmokeFilter } from "./feedFilters.js";
import { loadApprovalRequestDetail } from "./approval-request-detail.js";
import { loadAppReadiness } from "./app-readiness.js";
import { buildNotificationDeliveryStatus } from "./notification-delivery-status.js";
import { recordNotificationWebhookEvent } from "./notification-webhook.js";
import { parseResendWebhook } from "./notification-webhook-verification.js";
import { loadSubmissionRecord } from "./submission-record.js";
import { loadWorkflowEvents } from "./workflow-events.js";

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

function sendBinary(res, status, body, headers = {}) {
  res.writeHead(status, headers);

  if (body?.pipe) {
    body.pipe(res);
    return;
  }

  res.end(body);
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

async function enrichFeedMediaAsset(item) {
  const enriched = enrichMediaAsset(item);

  if (!enriched?.previewUrl) {
    return enriched;
  }

  if (!isDisplayPreviewMimeType(enriched.mimeType)) {
    return {
      ...enriched,
      previewUrl: null,
      previewUnavailableReason: "unsupported_format"
    };
  }

  try {
    await getStoredObjectMetadata(enriched.objectKey);
    return enriched;
  } catch (_error) {
    return {
      ...enriched,
      previewUrl: null,
      previewUnavailableReason: "missing_media"
    };
  }
}

async function enrichFeedMediaCollection(items) {
  if (!Array.isArray(items)) {
    return {
      displayableMedia: [],
      unavailableMedia: []
    };
  }

  const enrichedItems = await Promise.all(items.map(enrichFeedMediaAsset));
  return {
    displayableMedia: enrichedItems.filter((item) => item?.previewUrl),
    unavailableMedia: enrichedItems.filter((item) => item && !item.previewUrl)
  };
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
        <p>${escapeHtml(publicAppName)} helps clubs, coaches, families, and team staff collect updates and move content through a structured review flow.</p>
        <h2>Contact Support</h2>
        <p>Email <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a> for help with account issues, alerts, TestFlight access, or app problems.</p>
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
        <p>${escapeHtml(publicAppName)} supports club content submissions, approvals, publishing workflows, and related mobile app usage.</p>
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
        visibility_target,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'received')
      RETURNING *
      `,
      [
        clubResult.rows[0].id,
        teamId,
        userResult.rows[0].id,
        contentType,
        rawText || null,
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
          mediaCount: media.length
        })
      ]
    );

    return createdSubmission;
  });

  sendJson(res, 201, { submission });
}

async function handleAppReadiness(res) {
  const readiness = await loadAppReadiness({
    pool: getPool()
  });

  sendJson(res, 200, readiness);
}

async function handleCreateUploadPlan(req, res) {
  const body = await readJson(req);
  const validation = validateUploadRequest(body);

  if (!validation.valid) {
    sendJson(res, 400, { error: validation.error });
    return;
  }

  const { clubSlug, files } = validation.value;
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

async function handleMediaPreview(res, searchParams) {
  const objectKey = searchParams.get("key");

  if (!objectKey || !objectKey.startsWith("uploads/")) {
    sendJson(res, 400, { error: "A valid media key is required" });
    return;
  }

  try {
    const object = await getStoredObject(objectKey);
    sendBinary(res, 200, object.Body, {
      "content-type": object.ContentType || "application/octet-stream",
      "cache-control": "public, max-age=300"
    });
  } catch (error) {
    sendNotFound(res);
  }
}

async function handleGetSubmission(res, submissionId) {
  const pool = getPool();
  const submission = await loadSubmissionRecord({
    pool,
    submissionId,
    enrichMediaCollection
  });

  if (!submission) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, submission);
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
          visibility_target = COALESCE($3, visibility_target),
          status = 'received',
          risk_score = NULL,
          routing_decision = NULL,
          caption_draft = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [submissionId, rawText, visibilityTarget]
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

async function handleApprovalQueue(res, { pool = getPool() } = {}) {
  const items = await loadApprovalQueue({ pool });
  sendJson(res, 200, { items });
}

async function handleApprovalRequestDetail(
  res,
  approvalRequestId,
  { pool = getPool() } = {}
) {
  const approvalRequest = await loadApprovalRequestDetail({
    pool,
    approvalRequestId,
    enrichMediaCollection
  });

  if (!approvalRequest) {
    sendNotFound(res);
    return;
  }

  sendJson(res, 200, approvalRequest);
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
    const authorization = await loadAuthorizedApprovalActor(
      client,
      approvalRequestId,
      actedByEmail
    );

    if (!authorization.found) {
      return null;
    }

    if (!authorization.authorized) {
      return {
        authorizationError: true,
        status: authorization.status,
        error: authorization.error
      };
    }

    const { actor, approvalRequest } = authorization;

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
      [approvalRequestId, actor.id, normalizedAction, notes || null]
    );

    await client.query(
      `
      UPDATE submissions
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [approvalRequest.submission_id, submissionStatusMap[normalizedAction]]
    );

    if (normalizedAction === "approve") {
      await client.query(
        `
        INSERT INTO submission_events (submission_id, event_name, payload)
        VALUES ($1, $2, $3::jsonb)
        `,
        [
          approvalRequest.submission_id,
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
        actor.id,
        approvalRequestId,
        normalizedAction,
        JSON.stringify({ notes: notes || null, reasonCode: reasonCode || null })
      ]
    );

    if (normalizedAction !== "approve") {
      await createAndDeliverNotification(client, {
        userId: approvalRequest.submitted_by_user_id,
        type:
          normalizedAction === "reject"
            ? "submission_rejected"
            : "submission_changes_requested",
        payload: {
          submissionId: approvalRequest.submission_id,
          approvalRequestId,
          action: normalizedAction,
          notes: notes || null,
          reasonCode: reasonCode || null
        },
        actorUserId: actor.id
      });
    }

    return {
      approvalRequestId,
      submissionId: approvalRequest.submission_id,
      action: normalizedAction
    };
  });

  if (!result) {
    sendNotFound(res);
    return;
  }

  if (result.authorizationError) {
    sendJson(res, result.status || 403, { error: result.error });
    return;
  }

  sendJson(res, 200, result);
}

async function handleInternalFeed(res, searchParams = new URLSearchParams()) {
  const includeSmoke = searchParams.get("includeSmoke") === "1";
  const smokeFilter = buildInternalFeedSmokeFilter(includeSmoke);
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
      s.routing_decision,
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
    WHERE TRUE
      ${smokeFilter.clause}
    GROUP BY pp.id, s.id, pd.id
    ORDER BY pp.published_at DESC
    LIMIT 50
    `,
    smokeFilter.values
  );

  const items = await Promise.all(result.rows.map(async (item) => {
    const media = await enrichFeedMediaCollection(item.media);

    return {
      ...item,
      media: media.displayableMedia,
      unavailable_media_count: media.unavailableMedia.length,
      unavailable_media_reasons: media.unavailableMedia.map((mediaItem) => ({
        objectKey: mediaItem.objectKey,
        mimeType: mediaItem.mimeType,
        reason: mediaItem.previewUnavailableReason || "unavailable"
      }))
    };
  }));

  sendJson(res, 200, { items });
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
  const result = await registerPushToken({
    body,
    withTransaction,
    defaultProvider: pushProvider
  });
  sendJson(res, result.status, result.payload);
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
  sendJson(
    res,
    200,
    buildNotificationDeliveryStatus({
      resendApiKey,
      notificationFromEmail,
      supportEmail,
      resendWebhookEndpointPath,
      resendWebhookSecret,
      resendWebhookEvents,
      pushNotificationsEnabled,
      pushProvider,
      pushProjectId
    })
  );
}

async function handleResendWebhook(req, res) {
  const rawBody = await readText(req);
  const parsed = parseResendWebhook({
    rawBody,
    resendWebhookSecret,
    headers: req.headers,
    verifySignature(body, headers) {
      return new Webhook(resendWebhookSecret).verify(body, headers);
    }
  });

  if (!parsed.ok) {
    sendJson(res, parsed.status, parsed.payload);
    return;
  }

  const result = await withTransaction((client) =>
    recordNotificationWebhookEvent(client, {
      event: parsed.event,
      verified: parsed.verified
    })
  );

  sendJson(res, 200, {
    received: true,
    verified: result.verified,
    webhookType: result.webhookType,
    matchedNotificationId: result.matchedNotificationId,
    emailId: result.emailId
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

async function handleWorkflowEvents(res, searchParams, { pool = getPool() } = {}) {
  const status = searchParams.get("status") || "failed";
  const items = await loadWorkflowEvents({ pool, status });
  sendJson(res, 200, { items });
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

export function createAppServer({ pool } = {}) {
  return http.createServer(async (req, res) => {
  try {
    const url = parseUrl(req);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
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

    if (req.method === "GET" && url.pathname === "/app/readiness") {
      await handleAppReadiness(res);
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

    if (req.method === "GET" && url.pathname === "/media/preview") {
      await handleMediaPreview(res, url.searchParams);
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
      await handleApprovalQueue(res, { pool: pool || getPool() });
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
      await handleApprovalRequestDetail(res, url.pathname.split("/")[2], {
        pool: pool || getPool()
      });
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
      await handleInternalFeed(res, url.searchParams);
      return;
    }

    if (req.method === "GET" && url.pathname === "/workflow-events") {
      await handleWorkflowEvents(res, url.searchParams, { pool: pool || getPool() });
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
}

export async function startAppServer({ listenPort = port, pool } = {}) {
  await ensureSeedData();
  const server = createAppServer({ pool });
  await new Promise((resolve) => {
    server.listen(listenPort, resolve);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startAppServer();
  console.log(`app-api listening on ${server.address().port}`);
}
