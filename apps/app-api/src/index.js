import http from "node:http";
import { ensureSeedData } from "./bootstrap.js";
import { withTransaction, getPool } from "./db.js";
import {
  readJson,
  sendJson,
  sendMethodNotAllowed,
  sendNotFound
} from "./http.js";
import { submissionEvents } from "../../../packages/shared/src/index.js";
import { createUploadPlan } from "./storage.js";

const port = Number(process.env.API_PORT || 4000);
const publicAppName = process.env.PUBLIC_PRODUCT_NAME || "Club Content";
const supportEmail = process.env.SUPPORT_EMAIL || "support@davmn.net";
const companyName = process.env.COMPANY_NAME || "Club Content";

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
  const result = await getPool().query(
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

  sendJson(res, 200, result.rows[0]);
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
              'actedByName', u.full_name
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

  sendJson(res, 200, result.rows[0]);
}

async function handleApprovalAction(req, res, approvalRequestId) {
  const body = await readJson(req);
  const { action, actedByEmail, notes } = body;

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
      SELECT ar.*, s.club_id, s.id AS submission_id
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
        JSON.stringify({ notes: notes || null })
      ]
    );

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

    if (req.method === "GET" && /^\/submissions\/[^/]+$/.test(url.pathname)) {
      await handleGetSubmission(res, url.pathname.split("/")[2]);
      return;
    }

    if (req.method === "GET" && url.pathname === "/approvals/queue") {
      await handleApprovalQueue(res);
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
