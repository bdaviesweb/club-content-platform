import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const port = 3001;
const apiBase = process.env.API_BASE_URL || "http://app-api:4000";
const defaultClubSlug =
  process.env.ADMIN_DEFAULT_CLUB_SLUG || process.env.DEMO_CLUB_SLUG || "demo-workspace";
const defaultActorEmail =
  process.env.ADMIN_SETTINGS_ACTOR_EMAIL ||
  process.env.DEMO_ADMIN_EMAIL ||
  process.env.DEMO_REVIEWER_EMAIL ||
  "";
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
        "Rejecting due to policy or brand fit."
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

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderChannelRow(channel = {}, index = 0) {
  const key = channel.key || "";
  const label = channel.label || "";
  const favorite = Boolean(channel.favorite);
  const allowed = channel.allowed !== false;
  const reviewRequired = Boolean(channel.reviewRequired);

  return `<div class="channel-row" data-channel-row>
    <div class="policy-field">
      <label>Key</label>
      <input class="small-input" data-channel-key value="${escapeHtml(key)}" placeholder="instagram" />
    </div>
    <div class="policy-field">
      <label>Label</label>
      <input class="small-input" data-channel-label value="${escapeHtml(label)}" placeholder="Instagram" />
    </div>
    <label class="channel-toggle"><input type="checkbox" data-channel-favorite${favorite ? " checked" : ""} /> Favorite</label>
    <label class="channel-toggle"><input type="checkbox" data-channel-allowed${allowed ? " checked" : ""} /> Allowed</label>
    <label class="channel-toggle"><input type="checkbox" data-channel-review${reviewRequired ? " checked" : ""} /> Review</label>
    <button class="button-secondary" type="button" data-remove-channel-row data-row-index="${index}">Remove</button>
  </div>`;
}

function renderMembershipRow(row = {}, index = 0, teamOptions = [], editableRoles = [], locked = false) {
  const teamSlug = row.teamSlug || "";
  const role = row.role || "submitter_parent";
  const email = row.email || "";
  const fullName = row.fullName || "";
  const title = locked ? "Locked role" : "Editable role";

  return `<div class="membership-row${locked ? " locked" : ""}" data-membership-row data-locked="${locked ? "true" : "false"}">
    <div class="membership-field">
      <label>Team</label>
      <select data-membership-team${locked ? " disabled" : ""}>
        ${teamOptions.map((team) => `<option value="${escapeHtml(team.slug || "")}"${String(team.slug || "") === teamSlug ? " selected" : ""}>${escapeHtml(team.name || "Club-wide")}</option>`).join("")}
      </select>
    </div>
    <div class="membership-field">
      <label>Role</label>
      <select data-membership-role${locked ? " disabled" : ""}>
        ${editableRoles.map((optionRole) => `<option value="${escapeHtml(optionRole)}"${optionRole === role ? " selected" : ""}>${escapeHtml(formatLabel(optionRole))}</option>`).join("")}
      </select>
    </div>
    <div class="membership-field">
      <label>Email</label>
      <input class="small-input" data-membership-email type="email" value="${escapeHtml(email)}"${locked ? " disabled" : ""} placeholder="parent@demo.local" />
    </div>
    <div class="membership-field">
      <label>Full name</label>
      <input class="small-input" data-membership-name value="${escapeHtml(fullName)}"${locked ? " disabled" : ""} placeholder="Taylor Parent" />
    </div>
    <div class="membership-actions">
      <span class="membership-state">${escapeHtml(title)}</span>
      ${locked ? "" : `<button class="button-secondary" type="button" data-remove-membership-row data-row-index="${index}">Remove</button>`}
    </div>
  </div>`;
}

function renderMembershipHistoryItem(item = {}) {
  const metadata = item.metadata || {};
  const diff = metadata.diff || { counts: { added: 0, removed: 0, updated: 0 }, added: [], removed: [], updated: [] };
  const actorLabel = item.actorName || item.actorEmail || "Unknown";
  const summary = `${diff.counts.added || 0} added, ${diff.counts.updated || 0} updated, ${diff.counts.removed || 0} removed`;

  return `<div class="membership-history-item">
    <strong>${escapeHtml(actorLabel)} · ${escapeHtml(formatRelativeTime(item.createdAt))}</strong>
    <div class="subtle">${escapeHtml(summary)}</div>
  </div>`;
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
    "www-authenticate": 'Basic realm="Content Review"'
  });
  res.end("Authentication required");
}

function layout(content, title = "Content Ops") {
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
      .quick-header {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: flex-start;
        margin-bottom: 14px;
      }
      .quick-header h1 {
        font-size: clamp(1.9rem, 6vw, 2.8rem);
        line-height: 0.96;
      }
      .quick-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .quick-main {
        max-width: 760px;
        margin: 0 auto;
      }
      .swipe-hint {
        display: grid;
        gap: 10px;
        margin-bottom: 14px;
      }
      .swipe-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .swipe-pill {
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255,255,255,0.76);
        border: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.9rem;
        font-weight: 700;
      }
      .quick-link {
        color: var(--green);
        text-decoration: none;
        font-weight: 700;
      }
      .quick-link:hover {
        text-decoration: underline;
      }
      .queue-list,
      .signal-list,
      .history-list,
      .post-grid {
        display: grid;
        gap: 10px;
      }
      .policy-grid {
        display: grid;
        gap: 12px;
      }
      .policy-toolbar,
      .policy-actions,
      .policy-head,
      .policy-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .policy-toolbar,
      .policy-actions,
      .policy-head {
        justify-content: space-between;
      }
      .policy-field {
        display: grid;
        gap: 6px;
        min-width: min(100%, 280px);
      }
      .policy-field label {
        font-size: 0.78rem;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .policy-field input,
      .policy-field textarea,
      .policy-field select {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 11px 12px;
        font: inherit;
        background: white;
      }
      .policy-field textarea {
        min-height: 92px;
        resize: vertical;
      }
      .policy-card {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255,255,255,0.78);
        padding: 14px;
      }
      .membership-grid {
        display: grid;
        gap: 12px;
      }
      .membership-toolbar,
      .membership-actions,
      .membership-head,
      .membership-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .membership-toolbar,
      .membership-actions,
      .membership-head {
        justify-content: space-between;
      }
      .membership-field {
        display: grid;
        gap: 6px;
        min-width: min(100%, 220px);
      }
      .membership-field label {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .membership-field input,
      .membership-field select {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 11px 12px;
        font: inherit;
        background: white;
      }
      .membership-table {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }
      .membership-row {
        display: grid;
        grid-template-columns: 1.25fr 1.1fr 1.2fr 1.2fr auto;
        gap: 8px;
        align-items: end;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255,255,255,0.9);
      }
      .membership-row.locked {
        opacity: 0.82;
        background: rgba(248, 245, 238, 0.9);
      }
      .membership-row .small-input,
      .membership-row select {
        min-width: 0;
        width: 100%;
      }
      .membership-state {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 700;
        background: rgba(104, 118, 111, 0.12);
        color: var(--muted);
      }
      .membership-history {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }
      .membership-history-item {
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255,255,255,0.72);
        border: 1px solid rgba(222,206,179,0.9);
      }
      .membership-history-item strong {
        display: block;
        margin-bottom: 6px;
      }
      .channel-table {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }
      .channel-row {
        display: grid;
        grid-template-columns: 1.4fr 1.4fr 0.8fr 0.8fr 0.95fr auto;
        gap: 8px;
        align-items: center;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255,255,255,0.9);
      }
      .channel-row .small-input {
        min-width: 0;
        width: 100%;
      }
      .channel-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.9rem;
        color: var(--muted);
      }
      .policy-note {
        color: var(--muted);
        line-height: 1.45;
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
        transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease, background 180ms ease;
        will-change: transform;
      }
      .stage-shell.swiping-approve {
        border-color: rgba(23, 103, 68, 0.5);
        box-shadow: 0 24px 42px rgba(23, 103, 68, 0.12);
        background: linear-gradient(180deg, rgba(238, 250, 243, 0.95), rgba(255, 251, 245, 0.98));
      }
      .stage-shell.swiping-approve.swipe-locked {
        border-color: rgba(23, 103, 68, 0.72);
        box-shadow: 0 28px 54px rgba(23, 103, 68, 0.2);
      }
      .stage-shell.swiping-changes {
        border-color: rgba(155, 97, 27, 0.45);
        box-shadow: 0 24px 42px rgba(155, 97, 27, 0.12);
        background: linear-gradient(180deg, rgba(252, 245, 230, 0.96), rgba(255, 251, 245, 0.98));
      }
      .stage-shell.swiping-changes.swipe-locked {
        border-color: rgba(155, 97, 27, 0.68);
        box-shadow: 0 28px 54px rgba(155, 97, 27, 0.18);
      }
      .stage-shell.swiping-reject {
        border-color: rgba(139, 52, 46, 0.45);
        box-shadow: 0 24px 42px rgba(139, 52, 46, 0.12);
        background: linear-gradient(180deg, rgba(251, 236, 234, 0.96), rgba(255, 251, 245, 0.98));
      }
      .stage-shell.swiping-reject.swipe-locked {
        border-color: rgba(139, 52, 46, 0.68);
        box-shadow: 0 28px 54px rgba(139, 52, 46, 0.18);
      }
      .stage-shell.action-flash {
        transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease, background 180ms ease, opacity 180ms ease;
      }
      .stage-shell.action-flash-good {
        border-color: rgba(23, 103, 68, 0.72);
        box-shadow: 0 30px 60px rgba(23, 103, 68, 0.18);
        background: linear-gradient(180deg, rgba(232, 248, 238, 0.98), rgba(248, 255, 251, 0.99));
      }
      .stage-shell.action-flash-review {
        border-color: rgba(155, 97, 27, 0.68);
        box-shadow: 0 30px 60px rgba(155, 97, 27, 0.16);
        background: linear-gradient(180deg, rgba(252, 242, 221, 0.99), rgba(255, 252, 246, 0.99));
      }
      .stage-shell.action-flash-alert {
        border-color: rgba(139, 52, 46, 0.68);
        box-shadow: 0 30px 60px rgba(139, 52, 46, 0.16);
        background: linear-gradient(180deg, rgba(251, 233, 231, 0.99), rgba(255, 250, 249, 0.99));
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
      .media-canvas {
        overflow: hidden;
        border-radius: 18px;
        border: 1px solid rgba(201, 181, 146, 0.6);
        background: rgba(255,255,255,0.82);
      }
      .media-preview {
        display: block;
        width: 100%;
        max-height: 560px;
        object-fit: contain;
        background: rgba(255,255,255,0.9);
      }
      .media-thumb-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .media-thumb {
        appearance: none;
        width: 100%;
        border-radius: 14px;
        border: 1px solid rgba(201, 181, 146, 0.6);
        background: rgba(255,255,255,0.78);
        padding: 8px;
        cursor: pointer;
      }
      .media-thumb.active {
        border-color: var(--green);
        box-shadow: inset 0 0 0 2px rgba(23, 103, 68, 0.14);
      }
      .media-thumb img,
      .media-thumb video {
        display: block;
        width: 100%;
        height: 84px;
        object-fit: cover;
        border-radius: 10px;
        background: rgba(240, 236, 226, 0.7);
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
        padding: 18px;
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
      .quick-main .decision-option strong {
        font-size: 1.06rem;
      }
      .quick-main .decision-option .subtle {
        font-size: 0.98rem;
        line-height: 1.45;
      }
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
      .reason-chip {
        border-radius: 16px;
        border: 1px solid rgba(222,206,179,0.95);
        background: rgba(255,255,255,0.9);
        padding: 12px 14px;
        text-align: left;
        display: grid;
        gap: 0;
        transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, background 140ms ease;
      }
      .reason-chip:hover {
        transform: translateY(-1px);
      }
      .reason-chip.active {
        border-color: var(--green);
        box-shadow: inset 0 0 0 2px rgba(23, 103, 68, 0.14), 0 10px 24px rgba(27, 33, 51, 0.08);
        transform: translateY(-1px);
      }
      .reason-chip.revise.active {
        border-color: var(--amber);
        background: rgba(255, 247, 235, 0.96);
        box-shadow: inset 0 0 0 2px rgba(155, 97, 27, 0.14), 0 10px 24px rgba(155, 97, 27, 0.12);
      }
      .reason-chip.reject.active {
        border-color: var(--red);
        background: rgba(255, 241, 239, 0.96);
        box-shadow: inset 0 0 0 2px rgba(139, 52, 46, 0.14), 0 10px 24px rgba(139, 52, 46, 0.12);
      }
      .reason-chip strong {
        display: block;
        font-size: 0.96rem;
        color: var(--ink);
      }
      .reason-chip .subtle {
        display: none;
        font-size: 0.88rem;
        line-height: 1.35;
        margin-top: 6px;
      }
      .reason-chip.active .subtle {
        display: block;
      }
      .chip-row { margin-top: 10px; }
      .decision-copy,
      .note-guidance {
        font-size: 0.96rem;
        line-height: 1.45;
      }
      .note-preview {
        margin-top: 10px;
        padding: 14px 14px 12px;
        border-radius: 18px;
        border: 1px solid rgba(23,103,68,0.14);
        background: linear-gradient(180deg, rgba(244,251,247,0.96), rgba(255,255,255,0.9));
        box-shadow: 0 12px 28px rgba(27, 33, 51, 0.06);
      }
      .note-preview strong {
        display: block;
        font-size: 0.82rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--ink-soft);
      }
      .note-preview p {
        margin-top: 6px;
        line-height: 1.45;
      }
      .note-preview-actions {
        margin-top: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .note-preview-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.82rem;
        color: var(--green);
        font-weight: 600;
      }
      .note-preview-badge::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: currentColor;
      }
      .inline-link {
        background: transparent;
        border: 0;
        padding: 0;
        color: var(--green);
        font-weight: 600;
        cursor: pointer;
      }
      .note-editor.hidden {
        display: none;
      }
      .action-feedback {
        margin-top: 12px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.82);
      }
      .action-feedback.good {
        background: var(--green-soft);
        border-color: rgba(23, 103, 68, 0.24);
        color: var(--green);
      }
      .action-feedback.review {
        background: var(--amber-soft);
        border-color: rgba(155, 97, 27, 0.24);
        color: var(--amber);
      }
      .action-feedback.alert {
        background: var(--red-soft);
        border-color: rgba(139, 52, 46, 0.24);
        color: var(--red);
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
      @media (max-width: 720px) {
        main {
          padding: 18px 12px 28px;
        }
        .quick-header {
          gap: 10px;
          margin-bottom: 12px;
        }
        .quick-actions {
          gap: 8px;
        }
        .panel {
          padding: 14px;
          border-radius: 18px;
        }
        .stage-shell {
          padding: 14px;
        }
        .stage-header h2 {
          font-size: 2rem;
        }
        .content-copy {
          font-size: 1.08rem;
        }
        .media-hero {
          padding: 12px;
          min-height: auto;
        }
        .media-preview {
          max-height: 460px;
        }
        .decision-option {
          padding: 16px;
          border-radius: 16px;
        }
        .dock-actions {
          flex-direction: column;
          align-items: stretch;
        }
        .dock-actions button {
          width: 100%;
        }
        .channel-row {
          grid-template-columns: 1fr;
        }
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

  const primaryAsset = detail.media[0];
  const renderAssetTag = (item, mode = "preview") => {
    if (!item?.previewUrl) {
      return "";
    }

    const className = mode === "preview" ? "media-preview" : "";
    const common = `src="${escapeHtml(item.previewUrl)}"${className ? ` class="${className}"` : ""}`;
    if (String(item.mimeType || "").startsWith("video/")) {
      const controls = mode === "preview" ? "controls playsinline preload=\"metadata\"" : "muted playsinline preload=\"metadata\"";
      return `<video ${common} ${controls}></video>`;
    }

    return `<img ${common} alt="${escapeHtml(item.mediaType || "submission media")}" loading="lazy" />`;
  };

  const secondaryThumbs = detail.media.length > 1
    ? `<div class="media-thumb-grid">
        ${detail.media
          .slice(0, 5)
          .map((item, index) => `<button
              class="media-thumb ${index === 0 ? "active" : ""}"
              type="button"
              data-media-thumb
              data-preview-url="${escapeHtml(item.previewUrl || "")}"
              data-mime-type="${escapeHtml(item.mimeType || "")}"
              data-media-type="${escapeHtml(item.mediaType || `Asset ${index + 1}`)}"
              aria-label="Show ${escapeHtml(item.mediaType || `asset ${index + 1}`)}"
              onclick="switchMediaPreview(this)"
            >
            ${item.previewUrl ? renderAssetTag(item, "thumb") : `<div class="subtle" style="min-height:84px; display:grid; place-items:center;">Asset ${index + 1}</div>`}
          </button>`)
          .join("")}
      </div>`
    : "";

  return `<div class="media-stage">
    <div class="media-hero">
      <div class="media-title">
        <div>
          <div class="section-label">Submission preview</div>
          <h3>${escapeHtml(detail.media.length === 1 ? '1 attached asset' : `${detail.media.length} attached assets`)}</h3>
        </div>
        ${renderStatusBadge(formatLabel(detail.content_type), "neutral")}
      </div>
      <div class="media-canvas">
        <div id="media-preview-frame">
          ${primaryAsset.previewUrl ? renderAssetTag(primaryAsset, "preview") : `<div class="media-placeholder">Preview not available for this asset yet.</div>`}
        </div>
      </div>
      ${secondaryThumbs}
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
        <div id="reject-confirmation" class="action-feedback alert hidden" style="margin-top:10px;">
          <strong>Confirm this rejection</strong>
          <p style="margin-top:6px; line-height:1.45;">Quick review asks for one more tap before a rejection goes through. This helps avoid accidental rejects on phone.</p>
        </div>
        <div id="notes-wrap" class="hidden" style="margin-top:10px;">
          <p id="note-guidance" class="subtle note-guidance hidden" style="margin-bottom:10px;"></p>
          <div class="chip-row hidden" id="reason-chips">
          ${recommendation.reasonChips
            .map(
              (chip) => `<button class="chip" type="button" onclick="applyNote('${escapeHtml(chip)}')">${escapeHtml(chip)}</button>`
            )
            .join("")}
          </div>
          <div id="note-preview" class="note-preview hidden">
            <strong>Ready to send</strong>
            <p id="note-preview-text"></p>
            <div class="note-preview-actions">
              <span class="note-preview-badge" id="note-preview-badge-text">Default note loaded</span>
              <button class="inline-link" type="button" id="note-toggle" onclick="toggleNoteEditor()">Edit note</button>
            </div>
          </div>
          <div id="note-editor" class="note-editor hidden">
            <textarea id="notes" placeholder="Tell the submitter exactly what needs to change." oninput="updateNotePreview()"></textarea>
          </div>
        </div>
      </div>

      <div class="dock-actions" style="margin-top:14px; justify-content:space-between; align-items:flex-end;">
        <div class="dock-actions">
          <button class="button-primary" id="submit-action" onclick="submitDecision('${escapeHtml(detail.id)}')">Approve and next</button>
          <button class="button-secondary" id="skip-button" onclick="window.location.href='${queueIds[1] ? `/?approvalRequestId=${encodeURIComponent(queueIds[1])}` : '/'}'">Skip for now</button>
        </div>
        <p id="action-status" class="subtle"></p>
      </div>

      <div id="action-feedback" class="action-feedback hidden">
        <strong id="action-feedback-title"></strong>
        <p id="action-feedback-copy" style="margin-top:6px; line-height:1.45;"></p>
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
            <pre>${escapeHtml(detail.media.length ? detail.media.map((item) => `${item.mediaType}: ${item.objectKey}${item.previewUrl ? `\npreview: ${item.previewUrl}` : ""}`).join("\n\n") : "No media metadata attached.")}</pre>
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
      <div class="quick-actions">
        ${renderStatusBadge(`${queue.length} waiting`, queue.length ? "review" : "good")}
        <a class="quick-link" href="/policy">Policy studio</a>
      </div>
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
      let rejectConfirmArmed = false;
      let selectedReasonCode = null;
      const quickReasonSets = {
        request_changes: [
          { code: 'missing_context', label: 'More context', helper: 'Ask for who, what, or when.', text: 'Please add more context so families know what happened.' },
          { code: 'caption_detail', label: 'One more detail', helper: 'Ask for one clear missing point.', text: 'Looks good, but the caption needs one clear detail added.' },
          { code: 'score_details', label: 'Score details', helper: 'Ask for the score, opponent, or event.', text: 'Please confirm the event, opponent, or score before we post this.' },
          { code: 'caption_tighten', label: 'Tighten caption', helper: 'Ask for a cleaner caption.', text: 'Please tighten the caption so it is ready to post.' }
        ],
        reject: [
          { code: 'club_guidelines', label: 'Off guidelines', helper: 'Use when the post does not fit the posting standards.', text: 'This does not fit the posting guidelines.' },
          { code: 'privacy_safe_retake', label: 'Safer retake', helper: 'Use when the media needs a privacy-safe replacement.', text: 'We cannot publish this without a clearer privacy-safe version.' },
          { code: 'stop_current_form', label: 'Stop this version', helper: 'Use when this exact post should not move forward.', text: 'This should not move forward in its current form.' },
          { code: 'admin_review_required', label: 'Admin follow-up', helper: 'Use when this needs a stronger admin conversation.', text: 'Please do not repost this item without admin review.' }
        ]
      };

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
        updateNotePreview();
      }

      function animateIn(element, offset = 12) {
        if (!element || typeof element.animate !== 'function') {
          return;
        }

        element.animate(
          [
            { opacity: 0, transform: 'translateY(' + offset + 'px) scale(0.985)' },
            { opacity: 1, transform: 'translateY(0px) scale(1)' }
          ],
          {
            duration: 190,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both'
          }
        );
      }

      function setNoteEditorVisible(visible) {
        const editor = document.getElementById('note-editor');
        const toggle = document.getElementById('note-toggle');
        if (!editor || !toggle) {
          return;
        }

        editor.classList.toggle('hidden', !visible);
        toggle.textContent = visible ? 'Hide editor' : 'Edit note';

        if (visible) {
          const input = document.getElementById('notes');
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }
      }

      function updateNotePreview() {
        const input = document.getElementById('notes');
        const preview = document.getElementById('note-preview');
        const previewText = document.getElementById('note-preview-text');
        const badge = document.getElementById('note-preview-badge-text');

        if (!input || !preview || !previewText) {
          return;
        }

        const value = input.value.trim();
        const wasHidden = preview.classList.contains('hidden');
        preview.classList.toggle('hidden', !value);
        previewText.textContent = value || '';
        if (badge) {
          badge.textContent = value ? 'Reply ready' : 'Default note loaded';
        }
        if (value && wasHidden) {
          animateIn(preview, 10);
        }
      }

      function toggleNoteEditor(forceOpen) {
        const editor = document.getElementById('note-editor');
        if (!editor) {
          return;
        }

        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : editor.classList.contains('hidden');
        setNoteEditorVisible(shouldOpen);
      }

      function applyReasonPreset(code, note, helper) {
        selectedReasonCode = code;
        document.querySelectorAll('[data-reason-code]').forEach((button) => {
          button.classList.toggle('active', button.dataset.reasonCode === code);
          if (button.dataset.reasonCode === code) {
            animateIn(button, 4);
          }
        });
        const noteGuidance = document.getElementById('note-guidance');
        if (noteGuidance && helper) {
          noteGuidance.textContent = helper;
          noteGuidance.classList.remove('hidden');
        }
        applyNote(note);
      }

      function renderReasonChips(action) {
        const chips = document.getElementById('reason-chips');
        const notes = document.getElementById('notes');
        const reasons = quickReasonSets[action] || [];

        if (!chips) {
          return;
        }

        if (!reasons.length) {
          chips.innerHTML = '';
          chips.classList.add('hidden');
          updateNotePreview();
          return;
        }

        chips.innerHTML = reasons
          .map((reason) => {
            const escapedText = reason.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
            const escapedHelper = reason.helper.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
            const escapedLabel = reason.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
            const escapedAttr = reason.text
              .replaceAll('&', '&amp;')
              .replaceAll('"', '&quot;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;');
            return '<button class="reason-chip ' + (action === 'reject' ? 'reject' : 'revise') + '" type="button" data-reason-code="' + reason.code + '" data-note="' + escapedAttr + '" onclick="applyReasonPreset(' + JSON.stringify(reason.code) + ', this.dataset.note, ' + JSON.stringify(reason.helper) + ')"><strong>' + escapedLabel + '</strong><span class="subtle">' + escapedHelper + '</span></button>';
          })
          .join('');
        chips.classList.remove('hidden');
        animateIn(chips, 10);

        if (notes && !notes.value.trim()) {
          notes.value = reasons[0].text;
          selectedReasonCode = reasons[0].code;
          document.querySelectorAll('[data-reason-code]').forEach((button) => {
            button.classList.toggle('active', button.dataset.reasonCode === reasons[0].code);
          });
          const noteGuidance = document.getElementById('note-guidance');
          if (noteGuidance) {
            noteGuidance.textContent = reasons[0].helper;
            noteGuidance.classList.remove('hidden');
          }
        }

        updateNotePreview();
        setNoteEditorVisible(false);
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
        const rejectConfirmation = document.getElementById('reject-confirmation');

        rejectConfirmArmed = false;
        selectedReasonCode = null;
        rejectConfirmation.classList.add('hidden');

        if (action === 'approve') {
          submit.textContent = 'Approve and next';
          submit.className = 'button-primary';
          decisionCopy.textContent = 'This will publish the item and move straight to the next queued review.';
          notesWrap.classList.add('hidden');
          chips.classList.add('hidden');
          chips.innerHTML = '';
          noteGuidance.classList.add('hidden');
          noteGuidance.textContent = '';
          notes.value = '';
          updateNotePreview();
          setNoteEditorVisible(false);
        } else if (action === 'request_changes') {
          submit.textContent = 'Send back with note';
          submit.className = 'button-warn';
          decisionCopy.textContent = 'This will return the item to the submitter. A clear note is required.';
          notesWrap.classList.remove('hidden');
          animateIn(notesWrap, 14);
          noteGuidance.classList.remove('hidden');
          noteGuidance.textContent = 'Pick the closest fix path.';
          notes.placeholder = 'Tell the submitter exactly what needs to change.';
          renderReasonChips('request_changes');
        } else {
          submit.textContent = 'Reject submission';
          submit.className = 'button-danger';
          decisionCopy.textContent = 'This will stop the item here. Record a short reason for the audit trail.';
          notesWrap.classList.remove('hidden');
          animateIn(notesWrap, 14);
          noteGuidance.classList.remove('hidden');
          noteGuidance.textContent = 'Pick the closest stop reason.';
          notes.placeholder = 'Explain why this should not move forward.';
          renderReasonChips('reject');
        }
      }

      function nextQueueTarget(currentId) {
        const index = queueIds.indexOf(currentId);
        if (index === -1) return '/';
        return queueIds[index + 1] ? '/?approvalRequestId=' + encodeURIComponent(queueIds[index + 1]) : '/';
      }

      function switchMediaPreview(button) {
        const frame = document.getElementById('media-preview-frame');
        if (!frame || !button) {
          return;
        }

        const previewUrl = button.dataset.previewUrl;
        const mimeType = button.dataset.mimeType || '';
        const mediaType = button.dataset.mediaType || 'submission media';

        if (!previewUrl) {
          frame.innerHTML = '<div class="media-placeholder">Preview not available for this asset yet.</div>';
        } else if (mimeType.startsWith('video/')) {
          frame.innerHTML = '<video class="media-preview" src="' + previewUrl + '" controls playsinline preload="metadata"></video>';
        } else {
          frame.innerHTML = '<img class="media-preview" src="' + previewUrl + '" alt="' + mediaType + '" loading="lazy" />';
        }

        document.querySelectorAll('[data-media-thumb]').forEach((thumb) => {
          thumb.classList.toggle('active', thumb === button);
        });
      }

      function showActionFeedback(action) {
        const feedback = document.getElementById('action-feedback');
        const title = document.getElementById('action-feedback-title');
        const copy = document.getElementById('action-feedback-copy');
        const shell = document.querySelector('.stage-shell');

        feedback.className = 'action-feedback';
        if (shell) {
          shell.classList.remove('action-flash-good', 'action-flash-review', 'action-flash-alert');
          shell.classList.add('action-flash');
        }

        if (action === 'approve') {
          feedback.classList.add('good');
          title.textContent = 'Approved.';
          copy.textContent = 'Sending this to the internal feed and loading the next item.';
          if (shell) shell.classList.add('action-flash-good');
        } else if (action === 'request_changes') {
          feedback.classList.add('review');
          title.textContent = 'Sent back for changes.';
          copy.textContent = 'The submitter will get your note and this item will wait for an updated version.';
          if (shell) shell.classList.add('action-flash-review');
        } else {
          feedback.classList.add('alert');
          title.textContent = 'Rejected.';
          copy.textContent = 'This item stops here and the submitter will be notified with your reason.';
          if (shell) shell.classList.add('action-flash-alert');
        }

        feedback.classList.remove('hidden');

        if (shell) {
          window.setTimeout(() => {
            shell.classList.remove('action-flash-good', 'action-flash-review', 'action-flash-alert');
          }, 760);
        }
      }

      function initQuickReviewGestures() {
        if (window.location.pathname !== '/quick-review') {
          return;
        }

        const shell = document.querySelector('.stage-shell');
        const status = document.getElementById('action-status');
        if (!shell) {
          return;
        }

        let startX = 0;
        let currentX = 0;
        let dragging = false;
        let statusBeforeSwipe = '';

        const clearSwipeState = () => {
          shell.classList.remove('swiping-approve', 'swiping-changes', 'swiping-reject', 'swipe-locked');
        };

        const updateSwipeIntent = (delta) => {
          clearSwipeState();

          if (delta >= 100) {
            shell.classList.add('swiping-approve');
            shell.classList.add('swipe-locked');
            if (status) status.textContent = 'Approve locked. Release, then tap Approve and next.';
            return;
          }

          if (delta >= 70) {
            shell.classList.add('swiping-approve');
            if (status) status.textContent = 'Approve selected. Keep going or release here.';
            return;
          }

          if (delta <= -170) {
            shell.classList.add('swiping-reject');
            shell.classList.add('swipe-locked');
            if (status) status.textContent = 'Reject locked. Release, then tap Reject submission.';
            return;
          }

          if (delta <= -90) {
            shell.classList.add('swiping-changes');
            shell.classList.add('swipe-locked');
            if (status) status.textContent = 'Send back locked. Release, then tap Send back with note.';
            return;
          }

          if (delta <= -70) {
            shell.classList.add('swiping-changes');
            if (status) status.textContent = 'Send back selected. Keep going or release here.';
            return;
          }

          if (status) status.textContent = statusBeforeSwipe;
        };

        const resetShell = () => {
          shell.style.transition = 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease, background 180ms ease';
          shell.style.transform = 'translateX(0px)';
          clearSwipeState();
          if (status) {
            status.textContent = statusBeforeSwipe;
          }
          window.setTimeout(() => {
            shell.style.transition = '';
          }, 180);
        };

        shell.addEventListener('touchstart', (event) => {
          if (!event.touches || event.touches.length !== 1) {
            return;
          }
          dragging = true;
          statusBeforeSwipe = status ? status.textContent : '';
          startX = event.touches[0].clientX;
          currentX = startX;
          shell.style.transition = '';
        }, { passive: true });

        shell.addEventListener('touchmove', (event) => {
          if (!dragging || !event.touches || event.touches.length !== 1) {
            return;
          }
          currentX = event.touches[0].clientX;
          const delta = Math.max(-160, Math.min(160, currentX - startX));
          let displayDelta = delta;
          if (delta >= 100) {
            displayDelta = 118;
          } else if (delta <= -170) {
            displayDelta = -138;
          } else if (delta <= -90) {
            displayDelta = -104;
          }
          const rotation = displayDelta / 28;
          shell.style.transform = 'translateX(' + displayDelta + 'px) rotate(' + rotation + 'deg)';
          updateSwipeIntent(delta);
        }, { passive: true });

        shell.addEventListener('touchend', () => {
          if (!dragging) {
            return;
          }
          dragging = false;
          const delta = currentX - startX;

          if (delta >= 100) {
            selectAction('approve');
            if (status) status.textContent = 'Approve selected. Tap Approve and next to confirm.';
          } else if (delta <= -170) {
            selectAction('reject');
            if (status) status.textContent = 'Reject selected. Tap Reject submission to confirm.';
          } else if (delta <= -90) {
            selectAction('request_changes');
            if (status) status.textContent = 'Send back selected. Tap Send back with note to confirm.';
          }

          resetShell();
        });
      }

      async function submitDecision(approvalRequestId) {
        const actedByEmail = document.getElementById('actedByEmail').value.trim();
        const notes = document.getElementById('notes').value.trim();
        const status = document.getElementById('action-status');
        const submit = document.getElementById('submit-action');
        const rejectConfirmation = document.getElementById('reject-confirmation');
        const isQuickReview = window.location.pathname === '/quick-review';

        if (!actedByEmail) {
          status.textContent = 'Reviewer email is required.';
          return;
        }
        if (['reject', 'request_changes'].includes(selectedAction) && !notes) {
          status.textContent = 'Add a clear reason before sending this back or rejecting it.';
          document.getElementById('notes').focus();
          return;
        }
        if (isQuickReview && selectedAction === 'reject' && !rejectConfirmArmed) {
          rejectConfirmArmed = true;
          rejectConfirmation.classList.remove('hidden');
          submit.textContent = 'Confirm rejection';
          status.textContent = 'Reject requires one more tap on quick review.';
          return;
        }

        status.textContent = 'Saving decision...';
        setButtonsDisabled(true);

        const response = await fetch('/ui/actions/' + approvalRequestId, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: selectedAction, actedByEmail, notes, reasonCode: selectedReasonCode })
        });
        const payload = await response.json();
        if (!response.ok) {
          status.textContent = payload.error || 'Action failed';
          setButtonsDisabled(false);
          return;
        }

        showActionFeedback(selectedAction);
        status.textContent = selectedAction === 'approve'
          ? 'Approved. Moving to the next item...'
          : selectedAction === 'request_changes'
            ? 'Sent back. Moving to the next item...'
            : 'Rejected. Moving to the next item...';

        window.setTimeout(() => {
          window.location.href = nextQueueTarget(approvalRequestId);
        }, 1250);
      }

      async function retryEvent(eventId) {
        const status = document.getElementById('event-status');
        status.textContent = 'Retrying event...';
        const response = await fetch('/ui/workflow-events/' + eventId + '/retry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actorEmail: 'review@demo-workspace.local',
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
      initQuickReviewGestures();
    </script>
  `);
}

async function renderQuickReviewHome(activeId) {
  const queueResponse = await fetchJson("/approvals/queue");
  const queue = queueResponse.items || [];
  const queueIds = queue.map((item) => item.id);
  const selectedId = activeId || queueIds[0] || null;
  const detail = selectedId ? await fetchJson(`/approval-requests/${selectedId}`) : null;
  const recommendation = detail ? recommendationFor(detail) : null;
  const currentIndex = selectedId ? queueIds.indexOf(selectedId) : -1;
  const remainingCount = currentIndex === -1 ? queue.length : Math.max(queue.length - currentIndex - 1, 0);

  if (!detail) {
    return layout(`
      <section class="quick-main">
        <div class="quick-header">
          <div>
            <div class="eyebrow">Quick review</div>
            <h1>No items waiting</h1>
            <p class="subtle" style="margin-top:10px;">The review queue is clear right now.</p>
          </div>
          <div class="quick-actions">
            <a class="quick-link" href="/">Open full workspace</a>
          </div>
        </div>
      </section>
    `, "Content Quick Review");
  }

  return layout(`
    <section class="quick-main">
      <div class="quick-header">
        <div>
          <div class="eyebrow">Quick review</div>
          <h1>Review one and keep moving.</h1>
          <p class="subtle" style="margin-top:8px;">Focused mobile-first view for fast approvals.</p>
        </div>
        <div class="quick-actions">
          ${renderStatusBadge(`${queue.length} in queue`, queue.length ? "review" : "good")}
          <span class="subtle">${escapeHtml(`${remainingCount} after this`)}</span>
          <a class="quick-link" href="/">Open full workspace</a>
        </div>
      </div>

      <div class="swipe-hint">
        <p class="subtle">Swipe right to preselect approve. Swipe left to preselect changes. Swipe farther left to preselect reject.</p>
        <div class="swipe-pills">
          <span class="swipe-pill">Right = approve</span>
          <span class="swipe-pill">Left = changes</span>
          <span class="swipe-pill">Far left = reject</span>
        </div>
      </div>

      ${renderCenterStage(detail, recommendation, queueIds)}
    </section>
  `, "Content Quick Review");
}

async function renderPolicyStudio(activeClubSlug = defaultClubSlug, actorEmail = defaultActorEmail) {
  let policyPayload = null;
  let membershipPayload = null;
  let loadError = "";
  let membershipLoadError = "";
  const resolvedActorEmail = String(actorEmail || defaultActorEmail || "").trim();

  try {
    policyPayload = await fetchJson(`/clubs/${encodeURIComponent(activeClubSlug)}/workflow-policy`);
  } catch (error) {
    loadError = error.message || "Unable to load workspace policy.";
    policyPayload = {
      clubSlug: activeClubSlug,
      clubName: activeClubSlug,
      policyKey: "default",
      config: {
        channels: [],
        review: {
          autoApproveMaxRisk: 0.2,
          alwaysReviewChannels: [],
          alwaysReviewKeywords: [],
          alwaysReviewContentTypes: []
        }
      }
    };
  }

  try {
    membershipPayload = await fetchJson(
      `/clubs/${encodeURIComponent(activeClubSlug)}/memberships?actorEmail=${encodeURIComponent(resolvedActorEmail)}`
    );
  } catch (error) {
    membershipLoadError = error.message || "Unable to load membership roster.";
    membershipPayload = {
      clubSlug: activeClubSlug,
      clubName: activeClubSlug,
      actor: {
        email: resolvedActorEmail,
        role: null,
        canView: false,
        canEditAll: false,
        editableRoles: []
      },
      teams: [{ id: null, slug: null, name: "Club-wide", ageGroup: null }],
      memberships: [],
      editableRoles: [],
      history: []
    };
  }

  const config = policyPayload.config || {};
  const review = config.review || {};
  const channels = Array.isArray(config.channels) ? config.channels : [];
  const membershipTeams = Array.isArray(membershipPayload.teams) ? membershipPayload.teams : [{ id: null, slug: null, name: "Club-wide", ageGroup: null }];
  const editableRoles = Array.isArray(membershipPayload.editableRoles) ? membershipPayload.editableRoles : [];
  const editableRoleSet = new Set(editableRoles);
  const memberships = Array.isArray(membershipPayload.memberships) ? membershipPayload.memberships : [];
  const editableMemberships = memberships.filter((row) => editableRoleSet.has(row.role));
  const lockedMemberships = memberships.filter((row) => !editableRoleSet.has(row.role));
  const membershipHistory = Array.isArray(membershipPayload.history) ? membershipPayload.history : [];

  return layout(`
    <section class="quick-main">
      <div class="quick-header">
        <div>
          <div class="eyebrow">Policy studio</div>
          <h1>Workspace rules, without JSON.</h1>
          <p class="subtle" style="margin-top:8px; max-width:760px;">These settings shape what Hermes can auto-approve, what gets human review, and which destinations are treated as favorites or review-only channels.</p>
        </div>
        <div class="quick-actions">
          <a class="quick-link" href="/">Back to review</a>
          <a class="quick-link" href="/quick-review">Quick review</a>
        </div>
      </div>

      ${loadError ? `<div class="action-feedback review" style="margin-bottom:14px;"><strong>Using defaults</strong><p style="margin-top:6px; line-height:1.45;">${escapeHtml(loadError)} You can still edit and save once the policy table is available.</p></div>` : ""}
      ${membershipLoadError ? `<div class="action-feedback review" style="margin-bottom:14px;"><strong>Membership roster unavailable</strong><p style="margin-top:6px; line-height:1.45;">${escapeHtml(membershipLoadError)} The policy section still loads.</p></div>` : ""}

      <div class="panel">
        <div class="policy-head">
          <div>
            <div class="section-label">Workspace</div>
            <h2>${escapeHtml(policyPayload.clubName || activeClubSlug)}</h2>
          </div>
          <span class="subtle">Last updated ${escapeHtml(policyPayload.updatedAt ? formatRelativeTime(policyPayload.updatedAt) : "recently")}</span>
        </div>

        <div class="policy-toolbar" style="margin-top:12px;">
          <div class="policy-field">
            <label for="club-slug">Workspace slug</label>
            <input id="club-slug" value="${escapeHtml(activeClubSlug)}" />
          </div>
          <div class="policy-field">
            <label for="actor-email">Actor email</label>
            <input id="actor-email" value="${escapeHtml(resolvedActorEmail)}" placeholder="admin@demo-club.local" />
          </div>
          <div class="policy-field">
            <label for="policy-key">Policy key</label>
            <input id="policy-key" value="${escapeHtml(policyPayload.policyKey || "default")}" />
          </div>
          <div class="policy-actions">
            <button class="button-secondary" type="button" onclick="loadPolicy()">Load workspace</button>
            <button class="button-primary" type="button" onclick="savePolicy()">Save policy</button>
          </div>
        </div>

        <div class="policy-note" style="margin-top:8px;">
          Membership editing follows the actor email above. Club admins can manage every role. Club comms can manage only non-admin roles.
        </div>

        <div class="policy-grid" style="margin-top:16px;">
          <div class="policy-card">
            <div class="section-label">Review thresholds</div>
            <div class="policy-row">
              <div class="policy-field">
                <label for="auto-approve-risk">Auto-approve max risk</label>
                <input id="auto-approve-risk" type="number" min="0" max="1" step="0.05" value="${escapeHtml(String(review.autoApproveMaxRisk ?? 0.2))}" />
              </div>
              <div class="policy-field" style="flex:1; min-width:240px;">
                <label for="review-content-types">Always review content types</label>
                <input id="review-content-types" value="${escapeHtml(splitCsv(review.alwaysReviewContentTypes).join(", "))}" placeholder="video" />
              </div>
            </div>
            <div class="policy-row" style="margin-top:10px;">
              <div class="policy-field" style="flex:1; min-width:240px;">
                <label for="review-keywords">Always review keywords</label>
                <textarea id="review-keywords" placeholder="injury, hospital, concussion">${escapeHtml(splitCsv(review.alwaysReviewKeywords).join(", "))}</textarea>
              </div>
              <div class="policy-field" style="flex:1; min-width:240px;">
                <label for="review-channels">Always review channels</label>
                <textarea id="review-channels" placeholder="X, TikTok">${escapeHtml(splitCsv(review.alwaysReviewChannels).join(", "))}</textarea>
              </div>
            </div>
          </div>

          <div class="policy-card">
            <div class="policy-head">
              <div>
                <div class="section-label">Channels</div>
                <p class="policy-note">These drive favorites in the composer and destination-specific review behavior.</p>
              </div>
              <button class="button-secondary" type="button" onclick="addChannelRow()">Add channel</button>
            </div>
            <div class="channel-table" id="channel-table">
              ${channels.map((channel, index) => renderChannelRow(channel, index)).join("")}
            </div>
          </div>
        </div>

        <div class="policy-card" style="margin-top:16px;">
          <div class="membership-head">
            <div>
              <div class="section-label">Club members</div>
              <p class="policy-note">Manage submitter, team manager, and publisher roles here. Admin roles stay locked for club comms.</p>
            </div>
            <div class="membership-actions">
              <span class="membership-state">Actor: ${escapeHtml(membershipPayload.actor?.email || resolvedActorEmail || "unknown")}</span>
              <span class="membership-state">Role: ${escapeHtml(membershipPayload.actor?.role || "none")}</span>
              <button class="button-secondary" type="button" onclick="addMembershipRow()">Add member</button>
            </div>
          </div>

          <div class="membership-toolbar" style="margin-top:12px;">
            <div class="membership-field">
              <label for="membership-scope">Editable roles</label>
              <input id="membership-scope" value="${escapeHtml((editableRoles || []).map((role) => formatLabel(role)).join(", ") || "None")}" disabled />
            </div>
            <div class="membership-field" style="flex:1; min-width: 300px;">
              <label>Scope note</label>
              <input value="${escapeHtml(membershipPayload.actor?.canEditAll ? "Can edit every role" : membershipPayload.actor?.role === "club_comms" ? "Can edit non-admin roles only" : "Read-only")}" disabled />
            </div>
          </div>

          <div class="membership-grid">
            <div>
              <div class="section-label">Editable roster</div>
              <div class="membership-table" id="membership-editable-table">
                ${editableMemberships.map((row, index) => renderMembershipRow(row, index, membershipTeams, editableRoles, false)).join("") || `<div class="membership-history-item"><strong>No editable members yet.</strong><div class="subtle">Add the first role to get started.</div></div>`}
              </div>
            </div>

            ${lockedMemberships.length ? `
              <div>
                <div class="section-label">Locked roster</div>
                <div class="membership-table" id="membership-locked-table">
                  ${lockedMemberships.map((row, index) => renderMembershipRow(
                    row,
                    index,
                    membershipTeams,
                    ["club_admin", "club_comms", "submitter_parent", "submitter_player", "submitter_coach", "team_manager", "publisher"],
                    true
                  )).join("")}
                </div>
              </div>
            ` : ""}
          </div>

          <div style="margin-top:16px;">
            <div class="section-label">Membership activity</div>
            <div class="membership-history" id="membership-history">
              ${membershipHistory.length ? membershipHistory.map((item) => renderMembershipHistoryItem(item)).join("") : `<div class="membership-history-item"><strong>No membership changes yet.</strong><div class="subtle">Save a roster change to create the first entry.</div></div>`}
            </div>
          </div>

          <div class="membership-actions" style="margin-top:16px;">
            <span id="membership-status" class="subtle"></span>
            <div class="quick-actions">
              <button class="button-secondary" type="button" onclick="resetMemberships()">Reset roster</button>
              <button class="button-primary" type="button" onclick="saveMemberships()">Save roster</button>
            </div>
          </div>
        </div>

        <div class="policy-actions" style="margin-top:16px;">
          <span id="policy-status" class="subtle"></span>
          <div class="quick-actions">
            <button class="button-secondary" type="button" onclick="resetPolicy()">Reset to defaults</button>
            <button class="button-primary" type="button" onclick="savePolicy()">Save policy</button>
          </div>
        </div>
      </div>
    </section>

    <script>
      const defaultPolicy = ${JSON.stringify(policyPayload)};
      const defaultMemberships = ${JSON.stringify(membershipPayload)};
      const membershipTeamOptions = ${JSON.stringify(membershipTeams)};
      const membershipEditableRoles = ${JSON.stringify(editableRoles)};
      const membershipAllRoles = ${JSON.stringify(["submitter_parent", "submitter_player", "submitter_coach", "team_manager", "club_admin", "club_comms", "publisher"])};

      function loadPolicy() {
        const clubSlug = document.getElementById('club-slug').value.trim();
        const actorEmail = document.getElementById('actor-email').value.trim();
        if (!clubSlug) return;
        window.location.href = '/policy?clubSlug=' + encodeURIComponent(clubSlug) + '&actorEmail=' + encodeURIComponent(actorEmail);
      }

      function membershipRowTemplate(row = {}, locked = false) {
        const roleOptions = locked ? membershipAllRoles : membershipEditableRoles;
        const selectTeamOptions = membershipTeamOptions.map((team) => \`<option value="\${String(team.slug || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}"\${String(team.slug || '') === String(row.teamSlug || '') ? ' selected' : ''}>\${String(team.name || 'Club-wide').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</option>\`).join('');
        const selectRoleOptions = roleOptions.map((optionRole) => \`<option value="\${optionRole}"\${optionRole === row.role ? ' selected' : ''}>\${roleLabel(optionRole)}</option>\`).join('');
        return \`
          <div class="membership-row\${locked ? ' locked' : ''}" data-membership-row data-locked="\${locked ? 'true' : 'false'}">
            <div class="membership-field">
              <label>Team</label>
              <select data-membership-team\${locked ? ' disabled' : ''}>
                \${selectTeamOptions}
              </select>
            </div>
            <div class="membership-field">
              <label>Role</label>
              <select data-membership-role\${locked ? ' disabled' : ''}>
                \${selectRoleOptions}
              </select>
            </div>
            <div class="membership-field">
              <label>Email</label>
              <input class="small-input" data-membership-email type="email" value="\${String(row.email || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}"\${locked ? ' disabled' : ''} placeholder="parent@demo.local" />
            </div>
            <div class="membership-field">
              <label>Full name</label>
              <input class="small-input" data-membership-name value="\${String(row.fullName || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}"\${locked ? ' disabled' : ''} placeholder="Taylor Parent" />
            </div>
            <div class="membership-actions">
              <span class="membership-state">\${locked ? 'Locked role' : 'Editable role'}</span>
              \${locked ? '' : '<button class="button-secondary" type="button" data-remove-membership-row>Remove</button>'}
            </div>
          </div>
        \`;
      }

      function roleLabel(value) {
        return String(value || '')
          .split('_')
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
      }

      function addMembershipRow() {
        const table = document.getElementById('membership-editable-table');
        const row = document.createElement('div');
        row.innerHTML = membershipRowTemplate({ role: membershipEditableRoles[0] || 'submitter_parent', teamSlug: '', email: '', fullName: '' }, false);
        const element = row.firstElementChild;
        element.querySelector('[data-remove-membership-row]').addEventListener('click', () => element.remove());
        table.appendChild(element);
      }

      function collectMembershipRows() {
        return Array.from(document.querySelectorAll('#membership-editable-table [data-membership-row]')).map((row) => ({
          teamSlug: row.querySelector('[data-membership-team]').value || null,
          role: row.querySelector('[data-membership-role]').value,
          email: row.querySelector('[data-membership-email]').value.trim(),
          fullName: row.querySelector('[data-membership-name]').value.trim()
        }));
      }

      function resetMemberships() {
        const editableTable = document.getElementById('membership-editable-table');
        const lockedTable = document.getElementById('membership-locked-table');
        const editableMemberships = (defaultMemberships.memberships || []).filter((row) => (defaultMemberships.editableRoles || []).includes(row.role));
        const lockedMemberships = (defaultMemberships.memberships || []).filter((row) => !(defaultMemberships.editableRoles || []).includes(row.role));

        editableTable.innerHTML = editableMemberships.length
          ? editableMemberships.map((row) => membershipRowTemplate(row, false)).join('')
          : '<div class="membership-history-item"><strong>No editable members yet.</strong><div class="subtle">Add the first role to get started.</div></div>';

        if (lockedTable) {
          lockedTable.innerHTML = lockedMemberships.map((row) => membershipRowTemplate(row, true)).join('');
        }

        editableTable.querySelectorAll('[data-remove-membership-row]').forEach((button) => {
          button.addEventListener('click', () => button.closest('[data-membership-row]').remove());
        });
      }

      function channelRowTemplate(channel = {}) {
        const row = document.createElement('div');
        row.className = 'channel-row';
        row.setAttribute('data-channel-row', '');
        row.innerHTML = \`
          <div class="policy-field">
            <label>Key</label>
            <input class="small-input" data-channel-key value="\${String(channel.key || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}" placeholder="instagram" />
          </div>
          <div class="policy-field">
            <label>Label</label>
            <input class="small-input" data-channel-label value="\${String(channel.label || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}" placeholder="Instagram" />
          </div>
          <label class="channel-toggle"><input type="checkbox" data-channel-favorite\${channel.favorite ? ' checked' : ''} /> Favorite</label>
          <label class="channel-toggle"><input type="checkbox" data-channel-allowed\${channel.allowed === false ? '' : ' checked'} /> Allowed</label>
          <label class="channel-toggle"><input type="checkbox" data-channel-review\${channel.reviewRequired ? ' checked' : ''} /> Review</label>
          <button class="button-secondary" type="button" data-remove-channel-row>Remove</button>
        \`;
        row.querySelector('[data-remove-channel-row]').addEventListener('click', () => row.remove());
        return row;
      }

      function addChannelRow() {
        document.getElementById('channel-table').appendChild(channelRowTemplate({}));
      }

      function collectPolicy() {
        const policyKey = document.getElementById('policy-key').value.trim() || 'default';
        const autoApproveMaxRisk = Number(document.getElementById('auto-approve-risk').value || 0.2);
        const alwaysReviewContentTypes = document.getElementById('review-content-types').value
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        const alwaysReviewKeywords = document.getElementById('review-keywords').value
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        const alwaysReviewChannels = document.getElementById('review-channels').value
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

        const channels = Array.from(document.querySelectorAll('[data-channel-row]')).map((row) => ({
          key: row.querySelector('[data-channel-key]').value.trim(),
          label: row.querySelector('[data-channel-label]').value.trim(),
          favorite: row.querySelector('[data-channel-favorite]').checked,
          allowed: row.querySelector('[data-channel-allowed]').checked,
          reviewRequired: row.querySelector('[data-channel-review]').checked
        })).filter((row) => row.key || row.label);

        return {
          policyKey,
          config: {
            channels,
            review: {
              autoApproveMaxRisk: Number.isFinite(autoApproveMaxRisk) ? autoApproveMaxRisk : 0.2,
              alwaysReviewContentTypes,
              alwaysReviewKeywords,
              alwaysReviewChannels
            }
          }
        };
      }

      async function savePolicy() {
        const clubSlug = document.getElementById('club-slug').value.trim();
        const actorEmail = document.getElementById('actor-email').value.trim();
        const status = document.getElementById('policy-status');
        if (!clubSlug) {
          status.textContent = 'Workspace slug is required.';
          return;
        }

        status.textContent = 'Saving policy...';
        const response = await fetch('/ui/policy/' + encodeURIComponent(clubSlug), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(collectPolicy())
        });
        const payload = await response.json();
        if (!response.ok) {
          status.textContent = payload.error || 'Save failed';
          return;
        }

        status.textContent = 'Saved. Reloading...';
        window.setTimeout(() => {
          window.location.href = '/policy?clubSlug=' + encodeURIComponent(clubSlug) + '&actorEmail=' + encodeURIComponent(actorEmail);
        }, 700);
      }

      async function saveMemberships() {
        const clubSlug = document.getElementById('club-slug').value.trim();
        const actorEmail = document.getElementById('actor-email').value.trim();
        const status = document.getElementById('membership-status');
        if (!clubSlug) {
          status.textContent = 'Workspace slug is required.';
          return;
        }
        if (!actorEmail) {
          status.textContent = 'Actor email is required.';
          return;
        }

        status.textContent = 'Saving membership roster...';
        const response = await fetch('/ui/memberships/' + encodeURIComponent(clubSlug), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actorEmail,
            memberships: collectMembershipRows()
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          status.textContent = payload.error || 'Save failed';
          return;
        }

        status.textContent = 'Saved. Reloading...';
        window.setTimeout(() => {
          window.location.href = '/policy?clubSlug=' + encodeURIComponent(clubSlug) + '&actorEmail=' + encodeURIComponent(actorEmail);
        }, 700);
      }

      function resetPolicy() {
        const channels = document.getElementById('channel-table');
        document.getElementById('policy-key').value = defaultPolicy.policyKey || 'default';
        document.getElementById('auto-approve-risk').value = defaultPolicy.config.review.autoApproveMaxRisk ?? 0.2;
        document.getElementById('review-content-types').value = (defaultPolicy.config.review.alwaysReviewContentTypes || []).join(', ');
        document.getElementById('review-keywords').value = (defaultPolicy.config.review.alwaysReviewKeywords || []).join(', ');
        document.getElementById('review-channels').value = (defaultPolicy.config.review.alwaysReviewChannels || []).join(', ');
        channels.innerHTML = '';
        (defaultPolicy.config.channels || []).forEach((channel) => channels.appendChild(channelRowTemplate(channel)));
      }

      document.querySelectorAll('[data-remove-channel-row]').forEach((button) => {
        button.addEventListener('click', () => button.closest('[data-channel-row]').remove());
      });
      document.querySelectorAll('#membership-editable-table [data-remove-membership-row]').forEach((button) => {
        button.addEventListener('click', () => button.closest('[data-membership-row]').remove());
      });
    </script>
  `, "Content Policy Studio");
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

    if (req.method === "GET" && url.pathname === "/quick-review") {
      const html = await renderQuickReviewHome(url.searchParams.get("approvalRequestId"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/policy") {
      const html = await renderPolicyStudio(
        url.searchParams.get("clubSlug") || defaultClubSlug,
        url.searchParams.get("actorEmail") || defaultActorEmail
      );
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

    if (req.method === "POST" && /^\/ui\/policy\/[^/]+$/.test(url.pathname)) {
      const clubSlug = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readJson(req);
      const payload = await fetchJson(`/clubs/${encodeURIComponent(clubSlug)}/workflow-policy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method === "POST" && /^\/ui\/memberships\/[^/]+$/.test(url.pathname)) {
      const clubSlug = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readJson(req);
      const payload = await fetchJson(`/clubs/${encodeURIComponent(clubSlug)}/memberships`, {
        method: "PUT",
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
