import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const port = 3001;
const apiBase = process.env.API_BASE_URL || "http://app-api:4000";
const authUser = process.env.ADMIN_BASIC_AUTH_USER || "";
const authPassword = process.env.ADMIN_BASIC_AUTH_PASSWORD || "";
const basicAuthEnabled = Boolean(authUser && authPassword);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(path, init) {
  const response = await fetch(`${apiBase}${path}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${path} failed: ${response.status} ${text}`);
  }
  return response.json();
}

function formatLabel(value) {
  return String(value ?? "n/a")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatRelativeTime(value) {
  if (!value) {
    return "Unknown";
  }

  const then = new Date(value);
  const diffMinutes = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function riskBand(riskScore) {
  const score = Number(riskScore || 0);
  if (score >= 0.75) {
    return { label: "High concern", className: "tone-high" };
  }
  if (score >= 0.35) {
    return { label: "Medium concern", className: "tone-mid" };
  }
  return { label: "Low concern", className: "tone-low" };
}

function recommendationFor(detail) {
  const score = Number(detail.risk_score || 0);
  const latestReview = detail.review_runs[0];
  const summary = latestReview?.summary || detail.routing_decision?.rationale || "No reviewer summary recorded.";
  const normalizedStatus = String(detail.submission_status || "").toLowerCase();
  const blockedRuns = detail.review_runs.filter((run) =>
    ["blocked", "flagged", "error"].includes(String(run.resultStatus || "").toLowerCase())
  );

  if (normalizedStatus === "needs_metadata") {
    return {
      decision: "Request changes",
      className: "recommendation-revise",
      shortReason: "Missing detail will slow approval.",
      explainer: "Send this back with a short note so the submitter can add the missing context and re-enter review cleanly.",
      notesRequired: true,
      defaultAction: "request_changes",
      reasonChips: [
        "Missing context or metadata.",
        "Please add who, what, and when.",
        "Need score, opponent, or event details."
      ]
    };
  }

  if (score >= 0.75 || blockedRuns.length) {
    return {
      decision: "Review carefully",
      className: "recommendation-reject",
      shortReason: "Higher-risk or flagged content needs a deliberate call.",
      explainer: summary,
      notesRequired: true,
      defaultAction: "request_changes",
      reasonChips: [
        "Risk or policy concern needs revision.",
        "Needs a manual review before publishing.",
        "Rejecting due to policy or club fit."
      ]
    };
  }

  return {
    decision: "Approve",
    className: "recommendation-approve",
    shortReason: "This looks routine and low-risk.",
    explainer: summary,
    notesRequired: false,
    defaultAction: "approve",
    reasonChips: [
      "Looks good as-is.",
      "Approved for the internal feed.",
      "Approved after routine review."
    ]
  };
}

function renderStatusBadge(label, tone = "neutral") {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuth(headerValue) {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }

  try {
    const raw = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
    const separator = raw.indexOf(":");
    if (separator === -1) {
      return null;
    }
    return {
      username: raw.slice(0, separator),
      password: raw.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function isAuthorized(req) {
  if (!basicAuthEnabled) {
    return true;
  }

  const credentials = parseBasicAuth(req.headers.authorization);
  if (!credentials) {
    return false;
  }

  return safeEqual(credentials.username, authUser) && safeEqual(credentials.password, authPassword);
}

function requestAuth(res) {
  res.writeHead(401, {
    "content-type": "text/plain; charset=utf-8",
    "www-authenticate": 'Basic realm="Club Content Review"'
  });
  res.end("Authentication required");
}

function layout(content, title = "Club Content Ops") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5efe3;
        --bg-wash: #fffaf3;
        --surface: rgba(255, 251, 245, 0.96);
        --surface-strong: #fffdf8;
        --surface-muted: rgba(255, 255, 255, 0.72);
        --ink: #102319;
        --muted: #68766f;
        --line: #deceb3;
        --line-strong: #c8b28a;
        --shadow: 0 18px 36px rgba(16, 35, 25, 0.08);
        --green: #176744;
        --green-soft: #dff0e7;
        --amber: #9b611b;
        --amber-soft: #f8ead5;
        --red: #8b342e;
        --red-soft: #f6dfdc;
        --blue: #305e7a;
        --blue-soft: #dce9f1;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(23, 103, 68, 0.14), transparent 24%),
          radial-gradient(circle at top right, rgba(155, 97, 27, 0.14), transparent 20%),
          linear-gradient(180deg, var(--bg-wash) 0%, var(--bg) 100%);
        color: var(--ink);
      }
      h1, h2, h3, h4, p { margin: 0; }
      h1, h2, h3, h4 {
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      }
      main {
        max-width: 1440px;
        margin: 0 auto;
        padding: 28px 18px 40px;
      }
      .hero {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        margin-bottom: 20px;
      }
      .hero h1 {
        font-size: clamp(2.1rem, 4vw, 3.2rem);
        line-height: 0.98;
        max-width: 780px;
      }
      .eyebrow {
        color: var(--green);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.8rem;
        font-weight: 700;
        margin-bottom: 8px;
      }
      .subtle { color: var(--muted); }
      .topline {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .metric, .panel, .queue-card, .post-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: var(--shadow);
      }
      .metric { padding: 14px 16px; }
      .metric-label {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.75rem;
        margin-bottom: 6px;
        font-weight: 700;
      }
      .metric strong {
        display: block;
        font-size: 1.5rem;
        line-height: 1.1;
      }
      .workspace {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        align-items: start;
      }
      .panel { padding: 18px; }
      .decision-dock {
        position: static;
      }
      .queue-toggle {
        margin-bottom: 18px;
      }
      .queue-toggle summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 20px;
        box-shadow: var(--shadow);
        font-weight: 700;
      }
      .queue-toggle summary::-webkit-details-marker { display: none; }
      .queue-toggle[open] summary {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
      .queue-toggle .queue-panel {
        border-top-left-radius: 0;
        border-top-right-radius: 0;
        border-top: 0;
        box-shadow: var(--shadow);
      }
      .queue-list,
      .signal-list,
      .history-list,
      .post-grid {
        display: grid;
        gap: 10px;
      }
      .queue-card {
        display: block;
        text-decoration: none;
        color: inherit;
        padding: 14px;
        background: var(--surface-muted);
        border-radius: 18px;
      }
      .queue-card.active {
        border-color: var(--green);
        box-shadow: inset 0 0 0 2px rgba(23, 103, 68, 0.16);
        background: linear-gradient(180deg, rgba(223, 240, 231, 0.7), rgba(255,255,255,0.8));
      }
      .queue-card:hover { border-color: var(--line-strong); }
      .header-row,
      .badge-row,
      .chip-row,
      .content-meta,
      .decision-actions,
      .dock-actions,
      .signal-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.82rem;
        font-weight: 700;
      }
      .badge-neutral { background: rgba(104, 118, 111, 0.12); color: var(--muted); }
      .badge-review { background: var(--amber-soft); color: var(--amber); }
      .badge-good { background: var(--green-soft); color: var(--green); }
      .badge-alert { background: var(--red-soft); color: var(--red); }
      .badge-info { background: var(--blue-soft); color: var(--blue); }
      .center-stage { display: grid; gap: 16px; }
      .stage-shell {
        padding: 20px;
        background: linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,251,245,0.96));
      }
      .stage-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .stage-header h2 {
        font-size: clamp(1.9rem, 3vw, 2.7rem);
        line-height: 1;
        margin-top: 6px;
      }
      .stage-copy {
        max-width: 720px;
        font-size: 1.02rem;
        line-height: 1.5;
        margin-top: 10px;
      }
      .media-stage,
      .summary-stack,
      .stage-card,
      .signal-card,
      .dock-block {
        border: 1px solid var(--line);
        border-radius: 20px;
        background: var(--surface-strong);
      }
      .media-stage {
        overflow: hidden;
      }
      .media-hero {
        min-height: 280px;
        padding: 18px;
        background:
          linear-gradient(135deg, rgba(23,103,68,0.12), rgba(48,94,122,0.12)),
          linear-gradient(180deg, #fbfffd 0%, #eef5f1 100%);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .media-title {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }
      .media-placeholder {
        border: 1px dashed var(--line-strong);
        border-radius: 18px;
        padding: 18px;
        background: rgba(255,255,255,0.6);
        color: var(--muted);
        line-height: 1.45;
      }
      .media-list {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .media-item {
        background: rgba(255,255,255,0.7);
        border: 1px solid rgba(201, 181, 146, 0.6);
        border-radius: 16px;
        padding: 12px 14px;
      }
      .content-stage {
        padding: 16px 18px 18px;
      }
      .section-label {
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 700;
        margin-bottom: 10px;
      }
      .content-copy {
        font-size: 1.18rem;
        line-height: 1.58;
      }
      .stage-card,
      .signal-card,
      .dock-block { padding: 14px; }
      .summary-stack { display: grid; gap: 12px; padding: 14px; }
      .summary-item,
      .history-item {
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255,255,255,0.72);
        border: 1px solid rgba(222,206,179,0.9);
      }
      .summary-item strong,
      .history-item strong { display: block; margin-bottom: 6px; }
      details.disclosure {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255,255,255,0.7);
      }
      details.disclosure summary {
        list-style: none;
        cursor: pointer;
        padding: 14px 16px;
        font-weight: 700;
      }
      details.disclosure summary::-webkit-details-marker { display: none; }
      details.disclosure[open] summary { border-bottom: 1px solid var(--line); }
      .disclosure-body { padding: 14px 16px 16px; }
      .decision-dock {
        display: grid;
        gap: 12px;
      }
      .decision-dock .panel {
        padding: 16px;
        background: rgba(255,251,245,0.98);
        border-color: var(--line-strong);
      }
      .decision-title {
        font-size: 1.45rem;
        line-height: 1.05;
      }
      .decision-options { display: grid; gap: 10px; margin-top: 12px; }
      .decision-option {
        border-radius: 18px;
        border: 1px solid var(--line);
        padding: 14px;
        background: var(--surface-strong);
        cursor: pointer;
        text-align: left;
        transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }
      .decision-option:hover { transform: translateY(-1px); }
      .decision-option.active {
        border-color: var(--green);
        box-shadow: inset 0 0 0 2px rgba(23, 103, 68, 0.14);
      }
      .decision-option.revise.active {
        border-color: var(--amber);
        box-shadow: inset 0 0 0 2px rgba(155, 97, 27, 0.14);
      }
      .decision-option.reject.active {
        border-color: var(--red);
        box-shadow: inset 0 0 0 2px rgba(139, 52, 46, 0.14);
      }
      .decision-option strong { display: block; margin-bottom: 6px; }
      input[type="text"],
      textarea {
        width: 100%;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: white;
        font: inherit;
        padding: 12px 14px;
      }
      textarea { min-height: 112px; resize: vertical; }
      button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 11px 16px;
        font: inherit;
        cursor: pointer;
      }
      button:disabled { opacity: 0.55; cursor: wait; }
      .button-primary { background: var(--green); color: white; }
      .button-secondary { background: var(--surface-muted); color: var(--ink); border: 1px solid var(--line); }
      .button-danger { background: var(--red); color: white; }
      .button-warn { background: var(--amber); color: white; }
      .chip {
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.86);
        border-radius: 999px;
        padding: 8px 12px;
        cursor: pointer;
      }
      .chip-row { margin-top: 10px; }
      .decision-copy,
      .note-guidance {
        font-size: 0.96rem;
        line-height: 1.45;
      }
      .hidden { display: none; }
      .footer-panels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-top: 18px;
      }
      .post-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }
      .post-card { padding: 14px; background: var(--surface-muted); }
      pre {
        margin: 0;
        white-space: pre-wrap;
        font-family: "SFMono-Regular", ui-monospace, monospace;
        font-size: 0.88rem;
        line-height: 1.45;
      }
      @media (max-width: 1180px) {
        .workspace {
          grid-template-columns: 1fr;
        }
        .decision-dock { position: static; }
      }
    </style>
  </head>
  <body>
    <main>${content}</main>
  </body>
</html>`;
}

function renderQueue(queue, activeId) {
  if (!queue.length) {
    return `<div class="panel queue-panel"><h2>Queue</h2><p class="subtle">No pending reviews right now.</p></div>`;
  }

  const cards = queue
    .map((item, index) => {
      const active = item.id === activeId ? " active" : "";
      const band = riskBand(item.risk_score);
      const preview = item.raw_text || item.latest_review_summary || "No caption yet.";
      return `<a class="queue-card${active}" href="/?approvalRequestId=${encodeURIComponent(item.id)}">
        <div class="header-row">
          <strong>${index === 0 ? "Up next" : `Then ${index + 1}`}</strong>
          ${renderStatusBadge(band.label, band.className === "tone-high" ? "alert" : band.className === "tone-mid" ? "review" : "good")}
        </div>
        <div class="badge-row" style="margin-top:8px;">
          ${item.team_name ? renderStatusBadge(escapeHtml(item.team_name), "neutral") : renderStatusBadge(formatLabel(item.content_type || "post"), "neutral")}
          <span class="subtle">${escapeHtml(formatRelativeTime(item.created_at))}</span>
        </div>
        <p style="margin-top:10px; line-height:1.45;">${escapeHtml(preview).slice(0, 96)}</p>
      </a>`;
    })
    .join("");

  return `<div class="panel queue-panel">
    <h2>Review Queue</h2>
    <p class="subtle" style="margin-top:8px;">Pick one item, make the call, move on.</p>
    <div class="queue-list" style="margin-top:14px;">${cards}</div>
  </div>`;
}

function renderFooterPanels(feed, failedEvents) {
  const feedCards = feed.length
    ? feed
        .slice(0, 4)
        .map(
          (item) => `<div class="post-card">
            <div class="header-row">
              <strong>${escapeHtml(item.destination_name)}</strong>
              ${renderStatusBadge(formatLabel(item.content_type), "neutral")}
            </div>
            <p style="margin-top:10px; line-height:1.45;">${escapeHtml(item.caption_draft || item.raw_text || "No caption.")}</p>
            <p class="subtle" style="margin-top:8px;">${escapeHtml(item.submission_id)}</p>
          </div>`
        )
        .join("")
    : `<p class="subtle">Nothing has been published yet.</p>`;

  const eventCards = failedEvents.length
    ? failedEvents
        .map(
          (item) => `<div class="post-card">
            <div class="header-row">
              <strong>${escapeHtml(item.event_name)}</strong>
              ${renderStatusBadge(formatLabel(item.submission_status || "n/a"), "neutral")}
            </div>
            <p style="margin-top:8px; line-height:1.45;">${escapeHtml(item.processing_error || "No error recorded.")}</p>
            <p class="subtle" style="margin-top:8px;">${escapeHtml(item.submission_id || "No submission id")}</p>
            <div style="margin-top:10px;">
              <button class="button-secondary" onclick="retryEvent('${escapeHtml(item.id)}')">Retry event</button>
            </div>
          </div>`
        )
        .join("")
    : `<p class="subtle">No failed workflow events.</p>`;

  return `<div class="footer-panels">
    <div class="panel">
      <h3>Recent Internal Posts</h3>
      <div class="post-grid" style="margin-top:12px;">${feedCards}</div>
    </div>
    <div class="panel">
      <h3>Workflow Recovery</h3>
      <div class="post-grid" style="margin-top:12px;">${eventCards}</div>
      <p id="event-status" class="subtle" style="margin-top:12px;"></p>
    </div>
  </div>`;
}

function renderMediaStage(detail) {
  if (!detail.media.length) {
    return `<div class="media-stage">
      <div class="media-hero">
        <div class="media-title">
          <div>
            <div class="section-label">Submission preview</div>
            <h3>No media attached</h3>
          </div>
          ${renderStatusBadge(formatLabel(detail.content_type), "neutral")}
        </div>
        <div class="media-placeholder">
          This one is text-only. Read the caption, make the call, and leave a note only if they need to fix something.
        </div>
      </div>
    </div>`;
  }

  const mediaCards = detail.media
    .map(
      (item, index) => `<div class="media-item">
        <div class="header-row">
          <strong>${escapeHtml(item.mediaType || `Asset ${index + 1}`)}</strong>
          ${renderStatusBadge(item.storageBucket ? `bucket ${item.storageBucket}` : 'stored asset', 'info')}
        </div>
        <p class="subtle" style="margin-top:8px; line-height:1.45;">${escapeHtml(item.objectKey || 'No object key recorded.')}</p>
      </div>`
    )
    .join("");

  return `<div class="media-stage">
    <div class="media-hero">
      <div class="media-title">
        <div>
          <div class="section-label">Submission preview</div>
          <h3>${escapeHtml(detail.media.length === 1 ? '1 attached asset' : `${detail.media.length} attached assets`)}</h3>
        </div>
        ${renderStatusBadge(formatLabel(detail.content_type), "neutral")}
      </div>
      <div class="media-placeholder">
        Media rendering is still basic here. Use the caption and recommendation for the quick call, and open more details only if you need the storage trail.
      </div>
      <div class="media-list">${mediaCards}</div>
    </div>
  </div>`;
}

function renderReviewSignals(detail) {
  if (!detail.review_runs.length) {
    return `<p class="subtle">No review runs recorded.</p>`;
  }

  return detail.review_runs
    .map(
      (run) => `<div class="signal-card">
        <strong>${escapeHtml(run.agentName)}</strong>
        <div class="signal-meta" style="margin-top:8px;">
          ${renderStatusBadge(formatLabel(run.resultStatus), run.resultStatus === "passed" ? "good" : "review")}
          <span class="subtle">${escapeHtml(run.model)} • ${escapeHtml(formatRelativeTime(run.createdAt))}</span>
        </div>
        <p style="margin-top:10px; line-height:1.45;">${escapeHtml(run.summary || "No summary")}</p>
      </div>`
    )
    .join("");
}

function renderActionHistory(detail) {
  if (!detail.approval_actions.length) {
    return `<p class="subtle">No prior reviewer actions on this request.</p>`;
  }

  return detail.approval_actions
    .map(
      (item) => `<div class="history-item">
        <strong>${escapeHtml(formatLabel(item.action))}</strong>
        <p class="subtle">${escapeHtml(item.actedByName)} • ${escapeHtml(formatRelativeTime(item.createdAt))}</p>
        ${item.notes ? `<p style="margin-top:8px; line-height:1.45;">${escapeHtml(item.notes)}</p>` : ""}
      </div>`
    )
    .join("");
}

function renderDecisionDock(detail, queueIds, recommendation) {
  return `<div class="panel decision-dock" style="margin-top:14px;">
      <div class="section-label">Decision</div>
      <h3 class="decision-title">Make the call.</h3>
      <p class="subtle" style="margin-top:8px;">If it looks fine, approve it. If it needs work, send it back with one clear reason.</p>

      <div class="dock-block" style="margin-top:14px;">
        <div class="header-row">
          ${renderStatusBadge("A approve", "good")}
          ${renderStatusBadge("C changes", "review")}
          ${renderStatusBadge("R reject", "alert")}
        </div>
        <div class="decision-options" id="decision-grid">
          <button class="decision-option approve ${recommendation.defaultAction === "approve" ? "active" : ""}" type="button" data-action="approve" onclick="selectAction('approve')">
            <strong>Approve and next</strong>
            <span class="subtle">Publish this through the normal flow and load the next queued item.</span>
          </button>
          <button class="decision-option revise ${recommendation.defaultAction === "request_changes" ? "active" : ""}" type="button" data-action="request_changes" onclick="selectAction('request_changes')">
            <strong>Send back for changes</strong>
            <span class="subtle">Use this when the submitter can fix the issue quickly.</span>
          </button>
          <button class="decision-option reject ${recommendation.defaultAction === "reject" ? "active" : ""}" type="button" data-action="reject" onclick="selectAction('reject')">
            <strong>Reject submission</strong>
            <span class="subtle">Use this when the item should stop here.</span>
          </button>
        </div>
      </div>

      <div class="dock-block" style="margin-top:12px;">
        <div class="section-label">Reason if needed</div>
        <p id="decision-copy" class="subtle decision-copy"></p>
        <div id="notes-wrap" class="hidden" style="margin-top:10px;">
          <p id="note-guidance" class="subtle note-guidance hidden" style="margin-bottom:10px;"></p>
          <textarea id="notes" placeholder="Tell the submitter exactly what needs to change."></textarea>
        </div>
        <div class="chip-row hidden" id="reason-chips">
          ${recommendation.reasonChips
            .map(
              (chip) => `<button class="chip" type="button" onclick="applyNote('${escapeHtml(chip)}')">${escapeHtml(chip)}</button>`
            )
            .join("")}
        </div>
      </div>

      <div class="dock-actions" style="margin-top:14px; justify-content:space-between; align-items:flex-end;">
        <div class="dock-actions">
          <button class="button-primary" id="submit-action" onclick="submitDecision('${escapeHtml(detail.id)}')">Approve and next</button>
          <button class="button-secondary" id="skip-button" onclick="window.location.href='${queueIds[1] ? `/?approvalRequestId=${encodeURIComponent(queueIds[1])}` : '/'}'">Skip for now</button>
        </div>
        <p id="action-status" class="subtle"></p>
      </div>

      <details class="disclosure" style="margin-top:14px;">
        <summary>Reviewer settings</summary>
        <div class="disclosure-body">
          <label class="section-label" for="actedByEmail">Reviewer email</label>
          <input id="actedByEmail" type="text" value="${escapeHtml(detail.approver_email)}" placeholder="Reviewer email" />
        </div>
      </details>
  </div>`;
}

function renderCenterStage(detail, recommendation, queueIds) {
  const risk = riskBand(detail.risk_score);
  return `<section class="center-stage">
    <div class="panel stage-shell">
      <div class="stage-header">
        <div>
          <div class="section-label">Recommendation</div>
          <h2>${escapeHtml(recommendation.decision)}</h2>
          <p class="stage-copy">${escapeHtml(recommendation.shortReason)}</p>
        </div>
        <div class="badge-row">
          ${renderStatusBadge(risk.label, risk.className === "tone-high" ? "alert" : risk.className === "tone-mid" ? "review" : "good")}
        </div>
      </div>

      ${renderMediaStage(detail)}
      <div class="stage-card content-stage" style="margin-top:14px;">
        <div class="section-label">What they submitted</div>
        <p class="content-copy">${escapeHtml(detail.raw_text || "No caption or summary provided.")}</p>
        <div class="badge-row" style="margin-top:14px;">
          <span class="subtle">${escapeHtml(detail.submitter_name)}</span>
          ${detail.team_name ? `<span class="subtle">${escapeHtml(detail.team_name)}</span>` : ""}
          <span class="subtle">Submitted ${escapeHtml(formatRelativeTime(detail.created_at))}</span>
        </div>
      </div>

      <div class="stage-card" style="margin-top:14px;">
        <div class="section-label">Why this was suggested</div>
        <p style="margin-top:8px; line-height:1.55;">${escapeHtml(detail.review_runs[0]?.summary || detail.routing_decision?.rationale || recommendation.explainer || "No summary recorded.")}</p>
      </div>

      ${renderDecisionDock(detail, queueIds, recommendation)}
    </div>

    <details class="disclosure">
      <summary>More details</summary>
      <div class="disclosure-body">
        <div class="badge-row" style="margin-bottom:12px;">
          ${renderStatusBadge(formatLabel(detail.visibility_target), "info")}
          ${renderStatusBadge(formatLabel(detail.content_type), "neutral")}
          ${renderStatusBadge(formatLabel(detail.submission_status), "review")}
        </div>
        <div class="signal-list">
          <div class="signal-card">
            <strong>Routing rationale</strong>
            <p style="margin-top:8px; line-height:1.45;">${escapeHtml(detail.routing_decision?.rationale || "No routing rationale recorded.")}</p>
          </div>
          <div class="signal-card">
            <strong>Media metadata</strong>
            <pre>${escapeHtml(detail.media.length ? detail.media.map((item) => `${item.mediaType}: ${item.objectKey}`).join("\n") : "No media metadata attached.")}</pre>
          </div>
          <div class="signal-card">
            <strong>Review signals</strong>
            <div class="signal-list" style="margin-top:10px;">${renderReviewSignals(detail)}</div>
          </div>
          <div class="signal-card">
            <strong>Action history</strong>
            <div class="history-list" style="margin-top:10px;">${renderActionHistory(detail)}</div>
          </div>
        </div>
      </div>
    </details>
  </section>`;
}

async function renderHome(activeId) {
  const queueResponse = await fetchJson("/approvals/queue");
  const queue = queueResponse.items || [];
  const queueIds = queue.map((item) => item.id);
  const selectedId = activeId || queueIds[0] || null;
  const detail = selectedId ? await fetchJson(`/approval-requests/${selectedId}`) : null;
  const recommendation = detail ? recommendationFor(detail) : null;
  const queuePreview = renderQueue(queue, selectedId);

  return layout(`
    <section class="hero">
      <div>
        <div class="eyebrow">Reviewer workspace</div>
        <h1>See it. Decide it. Move on.</h1>
        <p class="subtle" style="margin-top:10px; max-width:780px;">The default view is intentionally short: content, recommendation, action. Open more details only when you actually need them.</p>
      </div>
      ${renderStatusBadge(`${queue.length} waiting`, queue.length ? "review" : "good")}
    </section>

    <details class="queue-toggle">
      <summary>
        <span>Review queue</span>
        <span class="subtle">${escapeHtml(queue.length ? `${queue.length} waiting` : "Empty")}</span>
      </summary>
      ${queuePreview}
    </details>

    <section class="workspace">
      ${detail ? renderCenterStage(detail, recommendation, queueIds) : `<div class="panel"><h2>No item selected</h2><p class="subtle" style="margin-top:8px;">Pick a queued item to review it.</p></div>`}
    </section>

    <script>
      const queueIds = ${JSON.stringify(queueIds)};
      let selectedAction = ${JSON.stringify(detail ? recommendation.defaultAction : "approve")};

      function setButtonsDisabled(disabled) {
        document.querySelectorAll('button').forEach((button) => {
          if (button.id !== 'skip-button') {
            button.disabled = disabled;
          }
        });
      }

      function applyNote(note) {
        const input = document.getElementById('notes');
        input.value = note;
        input.focus();
      }

      function selectAction(action) {
        selectedAction = action;
        document.querySelectorAll('.decision-option').forEach((button) => {
          button.classList.toggle('active', button.dataset.action === action);
        });

        const submit = document.getElementById('submit-action');
        const notesWrap = document.getElementById('notes-wrap');
        const chips = document.getElementById('reason-chips');
        const notes = document.getElementById('notes');
        const decisionCopy = document.getElementById('decision-copy');
        const noteGuidance = document.getElementById('note-guidance');

        if (action === 'approve') {
          submit.textContent = 'Approve and next';
          submit.className = 'button-primary';
          decisionCopy.textContent = 'This will publish the item and move straight to the next queued review.';
          notesWrap.classList.add('hidden');
          chips.classList.add('hidden');
          noteGuidance.classList.add('hidden');
          noteGuidance.textContent = '';
          notes.value = '';
        } else if (action === 'request_changes') {
          submit.textContent = 'Send back with note';
          submit.className = 'button-warn';
          decisionCopy.textContent = 'This will return the item to the submitter. A clear note is required.';
          notesWrap.classList.remove('hidden');
          chips.classList.remove('hidden');
          noteGuidance.classList.remove('hidden');
          noteGuidance.textContent = 'Tell the submitter exactly what to fix so the item can come straight back into review.';
          notes.placeholder = 'Tell the submitter exactly what needs to change.';
        } else {
          submit.textContent = 'Reject submission';
          submit.className = 'button-danger';
          decisionCopy.textContent = 'This will stop the item here. Record a short reason for the audit trail.';
          notesWrap.classList.remove('hidden');
          chips.classList.remove('hidden');
          noteGuidance.classList.remove('hidden');
          noteGuidance.textContent = 'State the policy or club-fit reason clearly enough that another reviewer could defend the decision.';
          notes.placeholder = 'Explain why this should not move forward.';
        }
      }

      function nextQueueTarget(currentId) {
        const index = queueIds.indexOf(currentId);
        if (index === -1) return '/';
        return queueIds[index + 1] ? '/?approvalRequestId=' + encodeURIComponent(queueIds[index + 1]) : '/';
      }

      async function submitDecision(approvalRequestId) {
        const actedByEmail = document.getElementById('actedByEmail').value.trim();
        const notes = document.getElementById('notes').value.trim();
        const status = document.getElementById('action-status');

        if (!actedByEmail) {
          status.textContent = 'Reviewer email is required.';
          return;
        }
        if (['reject', 'request_changes'].includes(selectedAction) && !notes) {
          status.textContent = 'Add a clear reason before sending this back or rejecting it.';
          document.getElementById('notes').focus();
          return;
        }

        status.textContent = 'Saving decision...';
        setButtonsDisabled(true);

        const response = await fetch('/ui/actions/' + approvalRequestId, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: selectedAction, actedByEmail, notes })
        });
        const payload = await response.json();
        if (!response.ok) {
          status.textContent = payload.error || 'Action failed';
          setButtonsDisabled(false);
          return;
        }

        status.textContent = 'Saved. Loading the next item...';
        window.location.href = nextQueueTarget(approvalRequestId);
      }

      async function retryEvent(eventId) {
        const status = document.getElementById('event-status');
        status.textContent = 'Retrying event...';
        const response = await fetch('/ui/workflow-events/' + eventId + '/retry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actorEmail: 'comms@demo-club.local',
            notes: 'Retry requested from reviewer workspace.'
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          status.textContent = payload.error || 'Retry failed';
          return;
        }
        status.textContent = 'Event reset. Reloading...';
        window.location.reload();
      }

      document.addEventListener('keydown', (event) => {
        const target = event.target;
        const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
        if (tagName === 'input' || tagName === 'textarea') {
          return;
        }
        if (event.key === 'a' || event.key === 'A') {
          selectAction('approve');
        }
        if (event.key === 'c' || event.key === 'C') {
          selectAction('request_changes');
        }
        if (event.key === 'r' || event.key === 'R') {
          selectAction('reject');
        }
      });

      selectAction(selectedAction);
    </script>
  `);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      requestAuth(res);
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      const html = await renderHome(url.searchParams.get("approvalRequestId"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && /^\/ui\/actions\/[^/]+$/.test(url.pathname)) {
      const approvalRequestId = url.pathname.split("/")[3];
      const body = await readJson(req);
      const payload = await fetchJson(`/approval-requests/${approvalRequestId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method === "POST" && /^\/ui\/workflow-events\/[^/]+\/retry$/.test(url.pathname)) {
      const eventId = url.pathname.split("/")[3];
      const body = await readJson(req);
      const payload = await fetchJson(`/workflow-events/${eventId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    console.error("admin-web error", error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error.message || "Internal Server Error");
  }
});

server.listen(port, () => {
  console.log(`admin-web listening on ${port}`);
});
