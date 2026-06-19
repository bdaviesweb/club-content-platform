import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  choosePolicyApproverRole,
  choosePublishingPlan,
  defaultWorkflowPolicy,
  describePolicyApproverSource,
  shouldAutoApproveSubmission,
  shouldRequireSecondApproval
} from "../worker/src/workflow-policy.js";
import { resolveNotificationChannelPolicy } from "../../packages/shared/src/notification-delivery.js";
import { formatRoutingSourceLabel } from "./routingLabels.js";
import { summarizeReviewHandoff } from "./reviewHandoff.js";

const port = Number(process.env.PORT || 3001);
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

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "n/a";
  }

  return `${Math.round(Math.max(0, Math.min(number, 1)) * 100)}%`;
}

function formatPolicyJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return "{}";
  }
}

function formatPolicyList(value) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(", ");
}

function formatPolicyFieldLabel(value) {
  return String(value ?? "n/a")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function summarizePolicyHistoryValue(value) {
  if (value === null || value === undefined) {
    return "Unset";
  }

  if (typeof value === "boolean") {
    return value ? "Enabled" : "Disabled";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "[]";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function renderPolicySelectOptions(options, selectedValue, { allowEmpty = false, emptyLabel = "Inherit organization default" } = {}) {
  const rows = [];

  if (allowEmpty) {
    rows.push(
      `<option value="" ${selectedValue === null || selectedValue === undefined ? "selected" : ""}>${escapeHtml(emptyLabel)}</option>`
    );
  }

  for (const option of options) {
    rows.push(
      `<option value="${escapeHtml(option.value)}" ${selectedValue === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`
    );
  }

  return rows.join("");
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
      .metric-card {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.78);
      }
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
      .section-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        margin-bottom: 14px;
      }
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
      .ai-review-card {
        border-color: rgba(48, 94, 122, 0.24);
        background:
          linear-gradient(180deg, rgba(244, 249, 252, 0.94), rgba(255, 255, 255, 0.92));
      }
      .ai-review-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .ai-review-metric {
        padding: 12px;
        border-radius: 16px;
        border: 1px solid rgba(222,206,179,0.9);
        background: rgba(255,255,255,0.72);
        min-width: 0;
      }
      .ai-review-metric span {
        display: block;
        color: var(--muted);
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .ai-review-metric strong {
        display: block;
        margin-top: 5px;
        overflow-wrap: anywhere;
      }
      .finding-list {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }
      .finding-row {
        display: grid;
        gap: 6px;
        padding: 12px;
        border-radius: 16px;
        border: 1px solid rgba(222,206,179,0.9);
        background: rgba(255,255,255,0.76);
      }
      .finding-row header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .fallback-note {
        margin-top: 12px;
        padding: 12px;
        border-radius: 16px;
        border: 1px solid rgba(155, 97, 27, 0.24);
        background: var(--amber-soft);
        color: var(--amber);
        line-height: 1.45;
      }
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
      input[type="email"],
      input[type="number"],
      select,
      textarea {
        width: 100%;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: white;
        font: inherit;
        padding: 12px 14px;
      }
      select {
        appearance: none;
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
      .workflow-settings-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-top: 16px;
      }
      .workflow-policy-form {
        display: grid;
        gap: 14px;
      }
      .workflow-policy-filter {
        grid-template-columns: minmax(0, 1fr);
      }
      .workflow-form-panel {
        align-self: start;
      }
      .form-field {
        display: grid;
        gap: 8px;
      }
      .form-field span {
        font-weight: 700;
      }
      .policy-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
      }
      .policy-status {
        font-weight: 700;
      }
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
        .workflow-settings-grid {
          grid-template-columns: 1fr;
        }
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
        .ai-review-grid {
          grid-template-columns: 1fr;
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
      const routingSource = item.routing_decision?.routingSource || item.routing_decision?.routing_source;
      const handoff = summarizeReviewHandoff(item);
      return `<a class="queue-card${active}" href="/?approvalRequestId=${encodeURIComponent(item.id)}">
        <div class="header-row">
          <strong>${index === 0 ? "Up next" : `Then ${index + 1}`}</strong>
          ${renderStatusBadge(band.label, band.className === "tone-high" ? "alert" : band.className === "tone-mid" ? "review" : "good")}
        </div>
        <div class="badge-row" style="margin-top:8px;">
          ${item.team_name ? renderStatusBadge(escapeHtml(item.team_name), "neutral") : renderStatusBadge(formatLabel(item.content_type || "post"), "neutral")}
          ${routingSource ? renderStatusBadge(formatRoutingSourceLabel(routingSource), routingSource === "hermes_agent" ? "good" : "neutral") : ""}
          <span class="subtle">${escapeHtml(formatRelativeTime(item.created_at))}</span>
        </div>
        <p style="margin-top:10px; line-height:1.45;">${escapeHtml(preview).slice(0, 96)}</p>
        <p class="subtle" style="margin-top:8px; line-height:1.4;"><strong>${escapeHtml(handoff.label)}:</strong> ${escapeHtml(handoff.title)}.</p>
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

function renderAiReviewPanel(detail) {
  const latestReview = detail.review_runs[0];
  if (!latestReview) {
    return `<div class="stage-card ai-review-card" style="margin-top:14px;">
      <div class="section-label">AI review</div>
      <p class="subtle">No AI review has been recorded for this item yet.</p>
    </div>`;
  }

  const rawOutput = latestReview.rawOutput || {};
  const structuredReview = rawOutput.structuredReview || {};
  const fallbackReason = rawOutput.fallbackReason;
  const routingDecision = detail.routing_decision || {};
  const reviewRequiredReason =
    structuredReview.review_required_reason ||
    structuredReview.reviewRequiredReason ||
    detail.routing_decision?.rationale ||
    null;
  const findings = Array.isArray(latestReview.findings) ? latestReview.findings : [];

  const findingMarkup = findings.length
    ? `<div class="finding-list">
        ${findings
          .map(
            (finding) => `<div class="finding-row">
              <header>
                <strong>${escapeHtml(formatLabel(finding.type || "finding"))}</strong>
                ${renderStatusBadge(formatLabel(finding.severity || "medium"), finding.severity === "high" ? "alert" : finding.severity === "low" ? "good" : "review")}
              </header>
              <p class="subtle">${escapeHtml(finding.message || "No finding detail recorded.")}</p>
            </div>`
          )
          .join("")}
      </div>`
    : `<p class="subtle" style="margin-top:12px;">No specific findings were recorded.</p>`;

  return `<div class="stage-card ai-review-card" style="margin-top:14px;">
    <div class="header-row" style="justify-content:space-between;">
      <div>
        <div class="section-label">AI review</div>
        <h3>${escapeHtml(latestReview.summary || "Review completed.")}</h3>
      </div>
      ${renderStatusBadge(formatLabel(latestReview.resultStatus || "reviewed"), latestReview.resultStatus === "passed" ? "good" : "review")}
    </div>

    <div class="ai-review-grid">
      <div class="ai-review-metric">
        <span>Model</span>
        <strong>${escapeHtml(latestReview.model || "n/a")}</strong>
      </div>
      <div class="ai-review-metric">
        <span>Confidence</span>
        <strong>${escapeHtml(formatPercent(latestReview.confidence))}</strong>
      </div>
      <div class="ai-review-metric">
        <span>Risk score</span>
        <strong>${escapeHtml(formatPercent(rawOutput.riskScore ?? detail.risk_score))}</strong>
      </div>
      <div class="ai-review-metric">
        <span>Routing source</span>
        <strong>${escapeHtml(routingDecision.routingSource || "local_rules")}</strong>
      </div>
      <div class="ai-review-metric">
        <span>Routed approver</span>
        <strong>${escapeHtml(routingDecision.approverRole || detail.approver_role || "n/a")}</strong>
      </div>
    </div>

    ${reviewRequiredReason ? `<p style="margin-top:12px; line-height:1.45;">${escapeHtml(reviewRequiredReason)}</p>` : ""}
    ${fallbackReason ? `<div class="fallback-note"><strong>Fallback used</strong><p style="margin-top:6px;">${escapeHtml(fallbackReason)}</p></div>` : ""}
    ${findingMarkup}
  </div>`;
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
  const handoff = summarizeReviewHandoff(detail);
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

      ${renderAiReviewPanel(detail)}

      <div class="stage-card" style="margin-top:14px;">
        <div class="section-label">${escapeHtml(handoff.label)}</div>
        <h3>${escapeHtml(handoff.title)}</h3>
        <p class="subtle" style="margin-top:8px; line-height:1.45;">${escapeHtml(handoff.body)}</p>
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
            <strong>Routing decision</strong>
            <p style="margin-top:8px; line-height:1.45;">${escapeHtml(detail.routing_decision?.routingSource || "local_rules")} routed this to ${escapeHtml(detail.routing_decision?.approverRole || detail.approver_role || "n/a")}.</p>
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
      let rejectConfirmArmed = false;
      let selectedReasonCode = null;
      const quickReasonSets = {
        request_changes: [
          { code: 'missing_context', label: 'More context', helper: 'Ask for who, what, or when.', text: 'Please add more context so families know what happened.' },
          { code: 'caption_detail', label: 'One more detail', helper: 'Ask for one clear missing point.', text: 'Looks good, but the caption needs one clear detail added.' },
          { code: 'score_details', label: 'Score details', helper: 'Ask for the score, opponent, or event.', text: 'Please confirm the event, opponent, or score before we post this.' },
          { code: 'caption_tighten', label: 'Tighten caption', helper: 'Ask for a cleaner club-ready caption.', text: 'Please tighten the caption so it is club-ready.' }
        ],
        reject: [
          { code: 'club_guidelines', label: 'Off guidelines', helper: 'Use when the post does not fit club standards.', text: 'This does not fit club posting guidelines.' },
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

      async function waitForPublish(submissionId, status) {
        if (!submissionId) {
          status.textContent = 'Approved. Publish is running in the background.';
          return true;
        }

        for (let attempt = 0; attempt < 10; attempt += 1) {
          const response = await fetch('/ui/submissions/' + encodeURIComponent(submissionId));
          if (!response.ok) {
            status.textContent = 'Approved. Could not confirm publish yet.';
            return true;
          }

          const submission = await response.json();
          if (submission.status === 'published' && submission.publishedPost) {
            status.textContent = 'Published to ' + submission.publishedPost.destinationName + '. Moving to the next item...';
            return true;
          }

          if (submission.status === 'publish_failed') {
            status.textContent = 'Approved, but publishing failed. Check Workflow Recovery.';
            setButtonsDisabled(false);
            return false;
          }

          status.textContent = 'Approved. Waiting for publish...';
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }

        status.textContent = 'Approved. Publish is still processing; moving to the next item...';
        return true;
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
        if (selectedAction === 'approve') {
          status.textContent = 'Approved. Waiting for publish...';
          const shouldContinue = await waitForPublish(payload.submissionId, status);
          if (!shouldContinue) {
            return;
          }
        } else {
          status.textContent = selectedAction === 'request_changes'
            ? 'Sent back. Moving to the next item...'
            : 'Rejected. Moving to the next item...';
        }

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
    `, "Club Content Quick Review");
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
  `, "Club Content Quick Review");
}

function renderPolicyField({
  label,
  name,
  input,
  helper = "",
  actionHtml = "",
  areaKey = "",
  emphasized = false
}) {
  const anchorId = areaKey ? `policy-area-${areaKey}` : "";
  const style = emphasized
    ? ' style="scroll-margin-top:24px; border:1px solid rgba(59,130,246,0.24); box-shadow:0 0 0 3px rgba(191,219,254,0.55);"'
    : anchorId
      ? ' style="scroll-margin-top:24px;"'
      : "";

  return `<label class="form-field"${anchorId ? ` id="${escapeHtml(anchorId)}"` : ""}${style}>
    <span class="badge-row" style="justify-content:space-between; align-items:flex-start;">
      <span>${escapeHtml(label)}</span>
      ${actionHtml}
    </span>
    ${input}
    ${helper ? `<small class="subtle">${escapeHtml(helper)}</small>` : ""}
  </label>`;
}

function renderPolicyAreaResetButton({ areaLabel, fieldNames = [], allowInheritance = false }) {
  if (!allowInheritance || !fieldNames.length) {
    return "";
  }

  return `<button type="button" class="quick-link" data-reset-area-fields="${escapeHtml(
    JSON.stringify(fieldNames)
  )}" data-reset-area-label="${escapeHtml(areaLabel)}">Inherit this area</button>`;
}

function buildPolicyAreaAnchor(areaKey = "") {
  return areaKey ? `#policy-area-${areaKey}` : "";
}

function renderPolicyRulePreview(label, value) {
  return `<details class="policy-rule-preview">
    <summary>${escapeHtml(label)} preview</summary>
    <pre>${escapeHtml(formatPolicyJson(value || {}))}</pre>
  </details>`;
}

function isNonEmptyObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function describePolicySource({ clubValue, organizationValue }) {
  if (clubValue !== null && clubValue !== undefined) {
    return { label: "Club override", tone: "good" };
  }

  if (organizationValue !== null && organizationValue !== undefined) {
    if (typeof organizationValue !== "object" || Array.isArray(organizationValue) || isNonEmptyObject(organizationValue)) {
      return { label: "Organization default", tone: "neutral" };
    }
  }

  return { label: "Platform default", tone: "neutral" };
}

function pickPolicyValue(overrideValue, fallbackValue, defaultValue) {
  if (overrideValue !== null && overrideValue !== undefined) {
    return overrideValue;
  }

  if (fallbackValue !== null && fallbackValue !== undefined) {
    return fallbackValue;
  }

  return defaultValue;
}

function buildEffectivePolicyFromPolicies({
  organizationPolicy = {},
  clubPolicy = {}
} = {}) {
  return {
    defaultApproverRole: pickPolicyValue(
      clubPolicy.defaultApproverRole,
      organizationPolicy.defaultApproverRole,
      defaultWorkflowPolicy.defaultApproverRole
    ),
    publicApproverRole: pickPolicyValue(
      clubPolicy.publicApproverRole,
      organizationPolicy.publicApproverRole,
      defaultWorkflowPolicy.publicApproverRole
    ),
    mediumRiskApproverRole: pickPolicyValue(
      clubPolicy.mediumRiskApproverRole,
      organizationPolicy.mediumRiskApproverRole,
      defaultWorkflowPolicy.mediumRiskApproverRole
    ),
    allowAgentRouting: pickPolicyValue(
      clubPolicy.allowAgentRouting,
      organizationPolicy.allowAgentRouting,
      defaultWorkflowPolicy.allowAgentRouting
    ),
    autoApproveInternalLowRisk: pickPolicyValue(
      clubPolicy.autoApproveInternalLowRisk,
      organizationPolicy.autoApproveInternalLowRisk,
      defaultWorkflowPolicy.autoApproveInternalLowRisk
    ),
    autoApproveMaxRisk: pickPolicyValue(
      clubPolicy.autoApproveMaxRisk,
      organizationPolicy.autoApproveMaxRisk,
      defaultWorkflowPolicy.autoApproveMaxRisk
    ),
    autoApprovalRule: pickPolicyValue(
      clubPolicy.autoApprovalRule,
      organizationPolicy.autoApprovalRule,
      defaultWorkflowPolicy.autoApprovalRule
    ),
    routingRule: pickPolicyValue(
      clubPolicy.routingRule,
      organizationPolicy.routingRule,
      defaultWorkflowPolicy.routingRule
    ),
    approvalRule: pickPolicyValue(
      clubPolicy.approvalRule,
      organizationPolicy.approvalRule,
      defaultWorkflowPolicy.approvalRule
    ),
    publishingRule: pickPolicyValue(
      clubPolicy.publishingRule,
      organizationPolicy.publishingRule,
      defaultWorkflowPolicy.publishingRule
    ),
    notificationRule: pickPolicyValue(
      clubPolicy.notificationRule,
      organizationPolicy.notificationRule,
      defaultWorkflowPolicy.notificationRule
    )
  };
}

function parsePreviewDraft(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseSavedClubDeltaList(rawValue) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: String(item.name || "").trim(),
        liveOverrideCount: Number(item.liveOverrideCount || 0),
        previewOverrideCount: Number(item.previewOverrideCount || 0)
      }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

function summarizeContentTypeApprovers(rule = {}) {
  const approvers = rule?.contentTypeApprovers;
  if (!approvers || typeof approvers !== "object" || Array.isArray(approvers)) {
    return "No content-type routing overrides.";
  }

  const entries = Object.entries(approvers)
    .filter(([contentType, role]) => String(contentType || "").trim() && String(role || "").trim())
    .map(([contentType, role]) => `${formatLabel(contentType)} -> ${formatLabel(role)}`);

  return entries.length ? entries.join(", ") : "No content-type routing overrides.";
}

function summarizeAutoApprovalRule(rule = {}) {
  const allowed = formatPolicyList(rule?.allowedContentTypes);
  const blocked = formatPolicyList(rule?.blockedContentTypes);
  const parts = [];

  if (allowed) {
    parts.push(`Allowed: ${allowed}`);
  }
  if (blocked) {
    parts.push(`Blocked: ${blocked}`);
  }

  return parts.length ? parts.join(" | ") : "No content-type auto-approval filters.";
}

function summarizePublishingRule(rule = {}) {
  const defaults = formatPolicyList(rule?.destinations);
  const internal = formatPolicyList(rule?.visibilityDestinations?.internal);
  const publicDestinations = formatPolicyList(rule?.visibilityDestinations?.public);
  const parts = [];

  if (internal) {
    parts.push(`Internal -> ${internal}`);
  }
  if (publicDestinations) {
    parts.push(`Public -> ${publicDestinations}`);
  }
  if (defaults) {
    parts.push(`Fallback -> ${defaults}`);
  }

  return parts.length ? parts.join(" | ") : "Publishes to the internal feed by default.";
}

function summarizeNotificationRule(rule = {}) {
  const email =
    rule?.email === null || rule?.email === undefined
      ? "inherit/default"
      : rule.email
        ? "enabled"
        : "disabled";
  const push =
    rule?.push === null || rule?.push === undefined
      ? "inherit/default"
      : rule.push
        ? "enabled"
        : "disabled";
  const reviewStarted = rule?.eventChannels?.submission_review_started || {};
  const published = rule?.eventChannels?.submission_published || {};
  const reviewParts = [];
  const publishedParts = [];

  if (reviewStarted.email !== null && reviewStarted.email !== undefined) {
    reviewParts.push(`email ${reviewStarted.email ? "on" : "off"}`);
  }
  if (reviewStarted.push !== null && reviewStarted.push !== undefined) {
    reviewParts.push(`push ${reviewStarted.push ? "on" : "off"}`);
  }
  if (published.email !== null && published.email !== undefined) {
    publishedParts.push(`email ${published.email ? "on" : "off"}`);
  }
  if (published.push !== null && published.push !== undefined) {
    publishedParts.push(`push ${published.push ? "on" : "off"}`);
  }

  return [
    `Channels: email ${email}, push ${push}`,
    reviewParts.length ? `Review started -> ${reviewParts.join(", ")}` : null,
    publishedParts.length ? `Published -> ${publishedParts.join(", ")}` : null
  ]
    .filter(Boolean)
    .join(" | ");
}

function renderEffectivePolicyExplainCard({ label, source, summary }) {
  return `<div class="signal-card">
    <div class="badge-row" style="margin-bottom:10px;">
      <strong>${escapeHtml(label)}</strong>
      ${renderStatusBadge(source.label, source.tone)}
    </div>
    <p class="subtle">${escapeHtml(summary)}</p>
  </div>`;
}

function normalizeSimulationInput(input = {}) {
  const allowedContentTypes = new Set(["photo", "video", "text", "mixed"]);
  const allowedVisibilityTargets = new Set(["internal", "public"]);
  const allowedRoles = new Set(["team_manager", "club_comms", "club_admin"]);

  const contentType = allowedContentTypes.has(String(input.contentType || ""))
    ? String(input.contentType)
    : "video";
  const visibilityTarget = allowedVisibilityTargets.has(
    String(input.visibilityTarget || "")
  )
    ? String(input.visibilityTarget)
    : "public";
  const parsedRiskScore = Number(input.riskScore);
  const riskScore = Number.isFinite(parsedRiskScore)
    ? Math.max(0, Math.min(parsedRiskScore, 1))
    : 0.42;
  const moderationFlagged = String(input.moderationFlagged || "false") === "true";
  const agentSuggestedApproverRole = allowedRoles.has(
    String(input.agentSuggestedApproverRole || "")
  )
    ? String(input.agentSuggestedApproverRole)
    : "";

  return {
    contentType,
    visibilityTarget,
    riskScore,
    moderationFlagged,
    agentSuggestedApproverRole
  };
}

function simulatePolicyOutcome(policy = {}, simulationInput = {}) {
  const simulation = normalizeSimulationInput(simulationInput);
  const submission = {
    content_type: simulation.contentType,
    visibility_target: simulation.visibilityTarget
  };
  const reviewArtifacts = {
    riskScore: simulation.riskScore,
    moderation: {
      flagged: simulation.moderationFlagged
    },
    mode: "hermes"
  };

  const localApproverRole = choosePolicyApproverRole({
    visibilityTarget: simulation.visibilityTarget,
    riskScore: simulation.riskScore,
    contentType: simulation.contentType,
    policy
  });
  const localPolicySource = describePolicyApproverSource({
    visibilityTarget: simulation.visibilityTarget,
    riskScore: simulation.riskScore,
    contentType: simulation.contentType,
    policy
  });

  const routingDecision =
    localPolicySource !== "routing_rule_content_type" &&
    policy.allowAgentRouting &&
    simulation.agentSuggestedApproverRole
      ? {
          approverRole: simulation.agentSuggestedApproverRole,
          routingSource: "hermes_agent",
          policySource: "agent_override",
          localFallbackApproverRole: localApproverRole,
          localPolicySource
        }
      : {
          approverRole: localApproverRole,
          routingSource: "local_rules",
          policySource: localPolicySource,
          localFallbackApproverRole: null,
          localPolicySource: null
        };

  const autoApproval = shouldAutoApproveSubmission({
    submission,
    reviewArtifacts,
    policy
  });
  const secondApproval = autoApproval.allowed
    ? { required: false, reason: "auto_approved" }
    : shouldRequireSecondApproval({ submission, policy });
  const publishingPlan = choosePublishingPlan({ submission, policy });

  const reviewStartedNotifications = autoApproval.allowed
    ? null
    : {
        email: resolveNotificationChannelPolicy({
          notificationPolicy: policy.notificationRule || {},
          type: "submission_review_started",
          channel: "email"
        }),
        push: resolveNotificationChannelPolicy({
          notificationPolicy: policy.notificationRule || {},
          type: "submission_review_started",
          channel: "push"
        })
      };
  const publishedNotifications = {
    email: resolveNotificationChannelPolicy({
      notificationPolicy: policy.notificationRule || {},
      type: "submission_published",
      channel: "email"
    }),
    push: resolveNotificationChannelPolicy({
      notificationPolicy: policy.notificationRule || {},
      type: "submission_published",
      channel: "push"
    })
  };

  return {
    simulation,
    routingDecision,
    autoApproval,
    secondApproval,
    publishingPlan,
    reviewStartedNotifications,
    publishedNotifications
  };
}

function describeNotificationResult(result) {
  return result?.enabled
    ? "Enabled"
    : `Disabled (${formatLabel(result?.reason || "policy_disabled")})`;
}

function describeOutcomePath(outcome) {
  if (outcome.autoApproval.allowed) {
    return "Auto-approved";
  }

  if (outcome.secondApproval.required) {
    return "Two approvals";
  }

  return "One approval";
}

function summarizeOutcomeForDiff(outcome) {
  return {
    approver: formatLabel(outcome.routingDecision.approverRole),
    routing: formatRoutingSourceLabel(outcome.routingDecision.routingSource),
    path: describeOutcomePath(outcome),
    publishDestinations: outcome.publishingPlan.destinationTypes
      .map((destination) => formatLabel(destination))
      .join(", "),
    publishedEmail: describeNotificationResult(outcome.publishedNotifications.email),
    publishedPush: describeNotificationResult(outcome.publishedNotifications.push)
  };
}

function renderOutcomeDiffRow(label, liveValue, draftValue) {
  const changed = liveValue !== draftValue;
  return `<div class="signal-card">
    <div class="badge-row" style="justify-content:space-between; margin-bottom:10px;">
      <strong>${escapeHtml(label)}</strong>
      ${changed ? renderStatusBadge("Changed", "review") : renderStatusBadge("No change", "neutral")}
    </div>
    <div class="workflow-settings-grid" style="margin-top:0;">
      <div>
        <div class="metric-label">Live</div>
        <p>${escapeHtml(liveValue)}</p>
      </div>
      <div>
        <div class="metric-label">Draft</div>
        <p>${escapeHtml(draftValue)}</p>
      </div>
    </div>
  </div>`;
}

function renderOutcomeDiffCard({ liveOutcome, previewOutcome, previewScopeType }) {
  if (!liveOutcome || !previewOutcome || !previewScopeType) {
    return "";
  }

  const liveSummary = summarizeOutcomeForDiff(liveOutcome);
  const previewSummary = summarizeOutcomeForDiff(previewOutcome);

  return `<div class="signal-card" style="margin-bottom:16px;">
    <div class="badge-row" style="margin-bottom:10px;">
      <strong>What changes if you save this ${escapeHtml(previewScopeType)} draft</strong>
      ${renderStatusBadge("Live vs draft", "info")}
    </div>
    <p class="subtle">Compare the current workflow outcome against the unsaved draft before you commit the policy change.</p>
    <div class="signal-list" style="margin-top:14px;">
      ${renderOutcomeDiffRow("First approver", liveSummary.approver, previewSummary.approver)}
      ${renderOutcomeDiffRow("Routing source", liveSummary.routing, previewSummary.routing)}
      ${renderOutcomeDiffRow("Approval path", liveSummary.path, previewSummary.path)}
      ${renderOutcomeDiffRow("Publish destination", liveSummary.publishDestinations, previewSummary.publishDestinations)}
      ${renderOutcomeDiffRow("Published email", liveSummary.publishedEmail, previewSummary.publishedEmail)}
      ${renderOutcomeDiffRow("Published push", liveSummary.publishedPush, previewSummary.publishedPush)}
    </div>
  </div>`;
}

function buildOutcomeRiskWarnings({ liveOutcome, previewOutcome }) {
  if (!liveOutcome || !previewOutcome) {
    return [];
  }

  const warnings = [];

  if (liveOutcome.secondApproval.required && !previewOutcome.secondApproval.required) {
    warnings.push(
      "This draft removes the second human approval step for the simulated public submission."
    );
  }

  if (!liveOutcome.autoApproval.allowed && previewOutcome.autoApproval.allowed) {
    warnings.push(
      "This draft auto-approves a submission that currently requires human review."
    );
  }

  if (
    liveOutcome.publishedNotifications.email?.enabled &&
    !previewOutcome.publishedNotifications.email?.enabled
  ) {
    warnings.push(
      "This draft turns off the published email notification for the simulated submission."
    );
  }

  if (
    liveOutcome.publishedNotifications.push?.enabled &&
    !previewOutcome.publishedNotifications.push?.enabled
  ) {
    warnings.push(
      "This draft turns off the published push notification for the simulated submission."
    );
  }

  return warnings;
}

function buildPolicyGuardrailWarnings({
  scopeType,
  livePolicy = {},
  previewPolicy = {},
  affectedClubCount = 0,
  overrideBurdenSummary = null
}) {
  if (!scopeType) {
    return [];
  }

  const warnings = [];
  const scopeTarget =
    scopeType === "organization"
      ? affectedClubCount === 1
        ? "1 affected club"
        : `${affectedClubCount} affected clubs`
      : "this club";
  const liveSecondApproval = Boolean(
    livePolicy?.approvalRule?.requireSecondApprovalForPublic
  );
  const previewSecondApproval = Boolean(
    previewPolicy?.approvalRule?.requireSecondApprovalForPublic
  );

  if (liveSecondApproval && !previewSecondApproval) {
    warnings.push({
      title: "Public second approval removed",
      areaKey: "approvalRule",
      message:
        scopeType === "organization"
          ? `Public posts no longer require a second human approval for ${scopeTarget} that inherit this draft.`
          : "Public posts no longer require a second human approval for this club."
    });
  }

  const liveAutoApprove = Boolean(livePolicy?.autoApproveInternalLowRisk);
  const previewAutoApprove = Boolean(previewPolicy?.autoApproveInternalLowRisk);

  if (!liveAutoApprove && previewAutoApprove) {
    warnings.push({
      title: "Internal auto-approval enabled",
      areaKey: "autoApproveInternalLowRisk",
      message:
        scopeType === "organization"
          ? `Low-risk internal submissions can now auto-approve for ${scopeTarget} that inherit this draft.`
          : "Low-risk internal submissions can now auto-approve for this club."
    });
  }

  const liveAutoApproveMaxRisk =
    livePolicy?.autoApproveMaxRisk === null || livePolicy?.autoApproveMaxRisk === undefined
      ? null
      : Number(livePolicy.autoApproveMaxRisk);
  const previewAutoApproveMaxRisk =
    previewPolicy?.autoApproveMaxRisk === null ||
    previewPolicy?.autoApproveMaxRisk === undefined
      ? null
      : Number(previewPolicy.autoApproveMaxRisk);

  if (
    Number.isFinite(liveAutoApproveMaxRisk) &&
    Number.isFinite(previewAutoApproveMaxRisk) &&
    previewAutoApproveMaxRisk > liveAutoApproveMaxRisk
  ) {
    warnings.push({
      title: "Auto-approve threshold widened",
      areaKey: "autoApproveMaxRisk",
      message:
        scopeType === "organization"
          ? `The auto-approve max risk rises from ${liveAutoApproveMaxRisk.toFixed(
              2
            )} to ${previewAutoApproveMaxRisk.toFixed(
              2
            )} for ${scopeTarget} that inherit this draft.`
          : `The auto-approve max risk rises from ${liveAutoApproveMaxRisk.toFixed(
              2
            )} to ${previewAutoApproveMaxRisk.toFixed(2)} for this club.`
    });
  }

  const livePublishedEmail = resolveNotificationChannelPolicy({
    notificationPolicy: livePolicy.notificationRule || {},
    type: "submission_published",
    channel: "email"
  });
  const previewPublishedEmail = resolveNotificationChannelPolicy({
    notificationPolicy: previewPolicy.notificationRule || {},
    type: "submission_published",
    channel: "email"
  });

  if (livePublishedEmail.enabled && !previewPublishedEmail.enabled) {
    warnings.push({
      title: "Published email disabled",
      areaKey: "notificationRule",
      message:
        scopeType === "organization"
          ? `Published email coverage drops for ${scopeTarget} that inherit this draft.`
          : "Published email coverage drops for this club."
    });
  }

  const livePublishedPush = resolveNotificationChannelPolicy({
    notificationPolicy: livePolicy.notificationRule || {},
    type: "submission_published",
    channel: "push"
  });
  const previewPublishedPush = resolveNotificationChannelPolicy({
    notificationPolicy: previewPolicy.notificationRule || {},
    type: "submission_published",
    channel: "push"
  });

  if (livePublishedPush.enabled && !previewPublishedPush.enabled) {
    warnings.push({
      title: "Published push disabled",
      areaKey: "notificationRule",
      message:
        scopeType === "organization"
          ? `Published push coverage drops for ${scopeTarget} that inherit this draft.`
          : "Published push coverage drops for this club."
    });
  }

  if (
    scopeType === "organization" &&
    overrideBurdenSummary &&
    overrideBurdenSummary.projectedOverrideAreaCount >
      overrideBurdenSummary.currentOverrideAreaCount
  ) {
    const additionalOverrideAreas =
      overrideBurdenSummary.projectedOverrideAreaCount -
      overrideBurdenSummary.currentOverrideAreaCount;
    const expandingClubs = (overrideBurdenSummary.clubsGainingOverrides || []).length;
    warnings.push({
      title: "Override sprawl expands",
      areaKey: null,
      message: `This draft adds ${additionalOverrideAreas} override area${
        additionalOverrideAreas === 1 ? "" : "s"
      } across ${expandingClubs} club${expandingClubs === 1 ? "" : "s"}, increasing exception cleanup work.`
    });
  }

  return warnings;
}

function renderOutcomeRiskWarningsCard(warnings) {
  if (!warnings.length) {
    return "";
  }

  return `<div class="signal-card" style="margin-bottom:16px; border:1px solid rgba(180, 83, 9, 0.24); background: rgba(255, 247, 237, 0.92);">
    <div class="badge-row" style="margin-bottom:10px;">
      <strong>High-signal save warnings</strong>
      ${renderStatusBadge(`${warnings.length} flagged`, "review")}
    </div>
    <p class="subtle">These changes reduce review or notification coverage in the simulated workflow. Double-check them before saving.</p>
    <div class="summary-stack" style="margin-top:12px;">
      ${warnings
        .map(
          (warning) => `<div class="summary-item">
            <strong>Review before save</strong>
            <p>${escapeHtml(warning)}</p>
          </div>`
        )
        .join("")}
      </div>
    </div>`;
}

function renderPolicyGuardrailsCard(
  warnings,
  {
    scopeType = null,
    selectedClubSlug = "",
    simulationInput = null,
    previewScopeType = null,
    previewDraftPolicy = null
  } = {}
) {
  if (!warnings.length) {
    return "";
  }

  return `<div class="signal-card" style="margin-bottom:16px; border:1px solid rgba(180, 83, 9, 0.24); background: rgba(255, 247, 237, 0.92);">
    <div class="badge-row" style="margin-bottom:10px;">
      <strong>Policy guardrails</strong>
      ${renderStatusBadge(`${warnings.length} flagged`, "review")}
    </div>
    <p class="subtle">These warnings come from the policy diff itself, so they still show up even when a single simulator scenario would miss them.</p>
    <div class="summary-stack" style="margin-top:12px;">
      ${warnings
        .map(
          (warning) => `<div class="summary-item">
            <strong>${escapeHtml(warning.title)}</strong>
            <p style="margin-top:6px;">${escapeHtml(warning.message)}</p>
            ${
              scopeType === "organization" && warning.areaKey
                ? `<div class="badge-row" style="margin-top:10px;">
                    <a class="quick-link" href="${buildWorkflowSettingsLink({
                      clubSlug: selectedClubSlug,
                      clubView: "overrides",
                      clubArea: warning.areaKey,
                      simulationInput,
                      previewScopeType,
                      previewDraftPolicy
                    })}">Review ${escapeHtml(
                      formatPolicyFieldLabel(warning.areaKey).toLowerCase()
                    )} exceptions</a>
                    <a class="quick-link" href="${buildWorkflowSettingsLink({
                      clubSlug: selectedClubSlug,
                      clubView: "inheriting",
                      clubArea: warning.areaKey,
                      simulationInput,
                      previewScopeType,
                      previewDraftPolicy
                    })}">Review ${escapeHtml(
                      formatPolicyFieldLabel(warning.areaKey).toLowerCase()
                    )} inheriting clubs</a>
                  </div>`
                : ""
            }
          </div>`
        )
        .join("")}
    </div>
  </div>`;
}

function renderPolicySimulator({
  effectivePolicy,
  simulationInput,
  clubSlug,
  liveEffectivePolicy = null,
  previewContext = null
}) {
  if (!effectivePolicy) {
    return "";
  }

  const outcome = simulatePolicyOutcome(effectivePolicy, simulationInput);
  const liveOutcome = liveEffectivePolicy
    ? simulatePolicyOutcome(liveEffectivePolicy, simulationInput)
    : null;
  const {
    simulation,
    routingDecision,
    autoApproval,
    secondApproval,
    publishingPlan,
    reviewStartedNotifications,
    publishedNotifications
  } = outcome;
  const roleOptions = [
    { value: "team_manager", label: "Team manager" },
    { value: "club_comms", label: "Club comms" },
    { value: "club_admin", label: "Club admin" }
  ];
  const contentTypeOptions = [
    { value: "photo", label: "Photo" },
    { value: "video", label: "Video" },
    { value: "text", label: "Text" },
    { value: "mixed", label: "Mixed" }
  ];
  const visibilityOptions = [
    { value: "internal", label: "Internal" },
    { value: "public", label: "Public" }
  ];
  const booleanOptions = [
    { value: "false", label: "No" },
    { value: "true", label: "Yes" }
  ];

  const routingSummary =
    routingDecision.routingSource === "hermes_agent"
      ? `Hermes suggestion routes this to ${formatLabel(
          routingDecision.approverRole
        )}. Local fallback would have been ${formatLabel(
          routingDecision.localFallbackApproverRole
        )}.`
      : `This routes to ${formatLabel(
          routingDecision.approverRole
        )} from ${formatLabel(routingDecision.policySource)}.`;
  const approvalSummary = autoApproval.allowed
    ? `This skips human review because ${formatLabel(
        autoApproval.reason
      )}.`
    : secondApproval.required
      ? `This goes through primary review and then a second public approval because ${formatLabel(
          secondApproval.reason
        )}.`
      : "This goes through one human approval step before publishing.";
  const publishSummary = `If approved, this publishes to ${publishingPlan.destinationTypes
    .map((destination) => formatLabel(destination))
    .join(", ")}.`;
  const previewNotice = previewContext
    ? `<div class="signal-card" style="margin-bottom:16px;">
        <div class="badge-row" style="margin-bottom:10px;">
          <strong>Previewing unsaved ${escapeHtml(previewContext.scopeType)} draft</strong>
          ${renderStatusBadge("Draft only", "review")}
        </div>
        <p class="subtle">This simulation is using the unsaved values from the ${escapeHtml(
          previewContext.scopeType
        )} policy form. Save when you are satisfied, or use the reset link to return to the live policy.</p>
        <p style="margin-top:10px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
          clubSlug,
          simulationInput
        })}">Reset to live policy</a></p>
      </div>`
    : "";
  const riskWarnings = previewContext
    ? buildOutcomeRiskWarnings({
        liveOutcome,
        previewOutcome: outcome
      })
    : [];
  const riskWarningsCard = previewContext
    ? renderOutcomeRiskWarningsCard(riskWarnings)
    : "";
  const outcomeDiffCard = previewContext
    ? renderOutcomeDiffCard({
        liveOutcome,
        previewOutcome: outcome,
        previewScopeType: previewContext.scopeType
      })
    : "";

  return `<section class="panel" style="margin-top:18px;">
    <div class="section-header">
      <div>
        <div class="eyebrow">Policy simulator</div>
        <h2>Simulate a submission before it hits the queue</h2>
        <p class="subtle" style="margin-top:8px;">Use the live effective policy for ${escapeHtml(
          clubSlug
        )} to preview routing, approval depth, publishing, and notification behavior.</p>
      </div>
    </div>
    ${previewNotice}
    ${riskWarningsCard}
    ${outcomeDiffCard}

    <form method="GET" action="/workflow-settings" class="workflow-policy-form">
      <input type="hidden" name="clubSlug" value="${escapeHtml(clubSlug)}" />
      <div class="workflow-settings-grid">
        ${renderPolicyField({
          label: "Content type",
          name: "simulationContentType",
          input: `<select name="simulationContentType">${renderPolicySelectOptions(
            contentTypeOptions,
            simulation.contentType
          )}</select>`
        })}
        ${renderPolicyField({
          label: "Visibility",
          name: "simulationVisibilityTarget",
          input: `<select name="simulationVisibilityTarget">${renderPolicySelectOptions(
            visibilityOptions,
            simulation.visibilityTarget
          )}</select>`
        })}
        ${renderPolicyField({
          label: "Risk score",
          name: "simulationRiskScore",
          helper: "Use the score range the worker actually uses, from 0.00 to 1.00.",
          input: `<input name="simulationRiskScore" type="number" min="0" max="1" step="0.01" value="${escapeHtml(
            String(simulation.riskScore)
          )}" />`
        })}
        ${renderPolicyField({
          label: "Moderation flagged",
          name: "simulationModerationFlagged",
          helper: "Flagged content can never auto-approve.",
          input: `<select name="simulationModerationFlagged">${renderPolicySelectOptions(
            booleanOptions,
            String(simulation.moderationFlagged)
          )}</select>`
        })}
        ${renderPolicyField({
          label: "Hermes suggested approver",
          name: "simulationAgentSuggestedApproverRole",
          helper: "Optional. Only changes the route when agent routing is enabled and no content-type rule wins first.",
          input: `<select name="simulationAgentSuggestedApproverRole">${renderPolicySelectOptions(
            roleOptions,
            simulation.agentSuggestedApproverRole || null,
            {
              allowEmpty: true,
              emptyLabel: "No Hermes override"
            }
          )}</select>`
        })}
      </div>
      <div class="policy-actions">
        <button type="submit" class="button-secondary">Run simulation</button>
        <span class="subtle">This uses the current effective policy, not draft form values.</span>
      </div>
    </form>

    <div class="topline" style="margin-top:18px;">
      <div class="metric-card">
        <span class="metric-label">Expected first approver</span>
        <strong>${escapeHtml(formatLabel(routingDecision.approverRole))}</strong>
        <span class="subtle">${escapeHtml(formatRoutingSourceLabel(routingDecision.routingSource))}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Review path</span>
        <strong>${escapeHtml(
          autoApproval.allowed
            ? "Auto-approved"
            : secondApproval.required
              ? "Two approvals"
              : "One approval"
        )}</strong>
        <span class="subtle">${escapeHtml(formatLabel(autoApproval.reason))}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Publish destination</span>
        <strong>${escapeHtml(
          publishingPlan.destinationTypes.map((destination) => formatLabel(destination)).join(", ")
        )}</strong>
        <span class="subtle">${escapeHtml(formatLabel(publishingPlan.policySource))}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Published email</span>
        <strong>${escapeHtml(
          publishedNotifications.email.enabled ? "On" : "Off"
        )}</strong>
        <span class="subtle">${escapeHtml(
          publishedNotifications.email.reason
            ? formatLabel(publishedNotifications.email.reason)
            : "Allowed"
        )}</span>
      </div>
    </div>

    <div class="signal-list" style="margin-top:16px;">
      <div class="signal-card">
        <div class="badge-row" style="margin-bottom:10px;">
          <strong>Routing outcome</strong>
          ${renderStatusBadge(formatLabel(routingDecision.policySource), routingDecision.routingSource === "hermes_agent" ? "good" : "neutral")}
        </div>
        <p class="subtle">${escapeHtml(routingSummary)}</p>
      </div>
      <div class="signal-card">
        <div class="badge-row" style="margin-bottom:10px;">
          <strong>Approval path</strong>
          ${renderStatusBadge(
            autoApproval.allowed
              ? "No queue stop"
              : secondApproval.required
                ? "Second approval required"
                : "Primary approval only",
            autoApproval.allowed ? "good" : "review"
          )}
        </div>
        <p class="subtle">${escapeHtml(approvalSummary)}</p>
      </div>
      <div class="signal-card">
        <div class="badge-row" style="margin-bottom:10px;">
          <strong>Publishing plan</strong>
          ${renderStatusBadge(formatLabel(publishingPlan.policySource), "neutral")}
        </div>
        <p class="subtle">${escapeHtml(publishSummary)}</p>
      </div>
      <div class="signal-card">
        <div class="badge-row" style="margin-bottom:10px;">
          <strong>Notifications</strong>
          ${renderStatusBadge("Review started", reviewStartedNotifications ? "review" : "neutral")}
          ${renderStatusBadge("Published", "good")}
        </div>
        <p class="subtle">
          ${escapeHtml(
            reviewStartedNotifications
              ? `Review started email: ${describeNotificationResult(
                  reviewStartedNotifications.email
                )}. Review started push: ${describeNotificationResult(
                  reviewStartedNotifications.push
                )}.`
              : "Review started notifications do not fire because this item auto-approves."
          )}
        </p>
        <p class="subtle" style="margin-top:8px;">
          ${escapeHtml(
            `Published email: ${describeNotificationResult(
              publishedNotifications.email
            )}. Published push: ${describeNotificationResult(
              publishedNotifications.push
            )}.`
          )}
        </p>
      </div>
    </div>
  </section>`;
}

function renderContentTypeRoleFields({
  baseName,
  label,
  helper,
  roleOptions,
  allowInheritance,
  values = {},
  actionHtml = "",
  areaKey = "",
  emphasized = false
}) {
  const contentTypes = [
    { key: "photo", label: "Photo" },
    { key: "video", label: "Video" },
    { key: "text", label: "Text" },
    { key: "mixed", label: "Mixed" }
  ];

  const inputs = contentTypes
    .map(
      (contentType) => `<label class="form-field">
        <span>${escapeHtml(contentType.label)}</span>
        <select name="${escapeHtml(baseName + contentType.key[0].toUpperCase() + contentType.key.slice(1))}">${renderPolicySelectOptions(roleOptions, values?.[contentType.key] ?? null, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization rule" : "Leave unset"
        })}</select>
      </label>`
    )
    .join("");

  const anchorId = areaKey ? `policy-area-${areaKey}` : "";
  const style = emphasized
    ? ' style="scroll-margin-top:24px; border:1px solid rgba(59,130,246,0.24); box-shadow:0 0 0 3px rgba(191,219,254,0.55);"'
    : anchorId
      ? ' style="scroll-margin-top:24px;"'
      : "";

  return `<div class="form-field"${anchorId ? ` id="${escapeHtml(anchorId)}"` : ""}${style}>
    <span class="badge-row" style="justify-content:space-between; align-items:flex-start;">
      <span>${escapeHtml(label)}</span>
      ${actionHtml}
    </span>
    ${helper ? `<small class="subtle">${escapeHtml(helper)}</small>` : ""}
    <div class="workflow-settings-grid">
      ${inputs}
    </div>
  </div>`;
}

function renderWorkflowPolicyForm({
  scopeType,
  scopeSlug,
  returnClubSlug = "",
  title,
  subtitle,
  policy,
  actorEmail = "",
  allowInheritance = false,
  previewScopeType = null,
  previewWarningCount = 0,
  previewAffectedClubCount = 0,
  previewChangedAreaCount = 0,
  previewInsulatedClubCount = 0,
  previewChangedAreaKeys = [],
  previewCurrentOverrideClubCount = 0,
  previewProjectedOverrideClubCount = 0,
  previewCurrentOverrideAreaCount = 0,
  previewProjectedOverrideAreaCount = 0,
  previewAddedAreaKeys = [],
  previewRemovedAreaKeys = [],
  previewRetainedAreaKeys = [],
  previewReducingClubs = [],
  previewGainingClubs = [],
  previewGuardrailWarnings = [],
  simulationInput = null,
  focusedInheritanceAreaKey = null,
  stagedCleanupAreaKey = null,
  stagedCleanupClubSlugs = []
}) {
  const roleOptions = [
    { value: "team_manager", label: "Team manager" },
    { value: "club_comms", label: "Club comms" },
    { value: "club_admin", label: "Club admin" }
  ];
  const booleanOptions = allowInheritance
    ? [
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" }
      ]
    : [
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" }
      ];

  const defaultApprover = policy?.defaultApproverRole ?? null;
  const publicApprover = policy?.publicApproverRole ?? null;
  const mediumRiskApprover = policy?.mediumRiskApproverRole ?? null;
  const allowAgentRouting = policy?.allowAgentRouting;
  const autoApproveInternalLowRisk = policy?.autoApproveInternalLowRisk;
  const autoApproveMaxRisk =
    policy?.autoApproveMaxRisk === null || policy?.autoApproveMaxRisk === undefined
      ? ""
      : String(policy.autoApproveMaxRisk);
  const autoApprovalRule = policy?.autoApprovalRule || {};
  const routingRule = policy?.routingRule || {};
  const autoApprovalAllowedContentTypes = formatPolicyList(
    autoApprovalRule?.allowedContentTypes
  );
  const autoApprovalBlockedContentTypes = formatPolicyList(
    autoApprovalRule?.blockedContentTypes
  );
  const routingContentTypeApprovers = routingRule?.contentTypeApprovers || {};
  const approvalRule = policy?.approvalRule || {};
  const publishingRule = policy?.publishingRule || {};
  const notificationRule = policy?.notificationRule || {};
  const approvalRuleSecondApproval =
    approvalRule?.requireSecondApprovalForPublic === null ||
    approvalRule?.requireSecondApprovalForPublic === undefined
      ? null
      : String(Boolean(approvalRule.requireSecondApprovalForPublic));
  const approvalRuleSecondApproverRole = approvalRule?.secondApproverRole ?? null;
  const approvalRuleSecondApprovalContentTypes = formatPolicyList(
    approvalRule?.secondApprovalContentTypes
  );
  const publishingRuleDestinations = formatPolicyList(
    publishingRule?.destinations
  );
  const publishingRuleInternalDestinations = formatPolicyList(
    publishingRule?.visibilityDestinations?.internal
  );
  const publishingRulePublicDestinations = formatPolicyList(
    publishingRule?.visibilityDestinations?.public
  );
  const notificationRuleEmail =
    notificationRule?.email === null || notificationRule?.email === undefined
      ? null
      : String(Boolean(notificationRule.email));
  const notificationRulePush =
    notificationRule?.push === null || notificationRule?.push === undefined
      ? null
      : String(Boolean(notificationRule.push));
  const reviewStartedEmail =
    notificationRule?.eventChannels?.submission_review_started?.email === null ||
    notificationRule?.eventChannels?.submission_review_started?.email === undefined
      ? null
      : String(Boolean(notificationRule.eventChannels.submission_review_started.email));
  const reviewStartedPush =
    notificationRule?.eventChannels?.submission_review_started?.push === null ||
    notificationRule?.eventChannels?.submission_review_started?.push === undefined
      ? null
      : String(Boolean(notificationRule.eventChannels.submission_review_started.push));
  const publishedEmail =
    notificationRule?.eventChannels?.submission_published?.email === null ||
    notificationRule?.eventChannels?.submission_published?.email === undefined
      ? null
      : String(Boolean(notificationRule.eventChannels.submission_published.email));
  const publishedPush =
    notificationRule?.eventChannels?.submission_published?.push === null ||
    notificationRule?.eventChannels?.submission_published?.push === undefined
      ? null
      : String(Boolean(notificationRule.eventChannels.submission_published.push));
  const guardrailCard =
    previewScopeType === scopeType
      ? renderPolicyGuardrailsCard(previewGuardrailWarnings, {
          scopeType,
          selectedClubSlug: returnClubSlug || scopeSlug,
          previewScopeType,
          simulationInput,
          previewDraftPolicy:
            previewScopeType === scopeType ? JSON.stringify(policy || {}) : null
        })
      : "";
  const focusedInheritanceArea =
    allowInheritance && previewScopeType === "club" && focusedInheritanceAreaKey
      ? trackedPolicyAreaFields.find((area) => area.key === focusedInheritanceAreaKey) || null
      : null;
  const focusedInheritanceCard = focusedInheritanceArea
    ? `<div class="signal-card" style="margin-bottom:16px; border:1px solid rgba(37, 99, 235, 0.18); background: rgba(239, 246, 255, 0.92);">
        <div class="badge-row" style="margin-bottom:10px;">
          <strong>Review ${escapeHtml(
            focusedInheritanceArea.label.toLowerCase()
          )} inheritance</strong>
          ${renderStatusBadge("Ready to save", "info")}
        </div>
        <p class="subtle">This preview cleared the club-specific ${escapeHtml(
          focusedInheritanceArea.label.toLowerCase()
        )} override so the area now follows the organization default unless you change it again before saving.</p>
        <div class="badge-row" style="margin-top:10px;">
          <a class="quick-link" href="${escapeHtml(
            buildPolicyAreaAnchor(focusedInheritanceArea.key)
          )}">Jump to this area</a>
          <a class="quick-link" href="${buildWorkflowSettingsLink({
            clubSlug: returnClubSlug || scopeSlug,
            simulationInput
          })}">Reset to live policy</a>
        </div>
      </div>`
    : "";

  return `<section class="panel workflow-form-panel">
    <div class="section-header">
      <div>
        <div class="eyebrow">${escapeHtml(scopeType === "club" ? "Club policy" : "Organization policy")}</div>
        <h2>${escapeHtml(title)}</h2>
        <p class="subtle" style="margin-top:8px;">${escapeHtml(subtitle)}</p>
      </div>
      <span class="badge badge-neutral">${escapeHtml(scopeSlug || "n/a")}</span>
    </div>
    ${guardrailCard}
    ${focusedInheritanceCard}
    <form class="workflow-policy-form" data-scope-type="${escapeHtml(scopeType)}" data-scope-slug="${escapeHtml(scopeSlug || "")}" data-return-club-slug="${escapeHtml(returnClubSlug || "")}" data-preview-warning-count="${escapeHtml(String(previewWarningCount))}" data-preview-affected-club-count="${escapeHtml(String(previewAffectedClubCount))}" data-preview-changed-area-count="${escapeHtml(String(previewChangedAreaCount))}" data-preview-insulated-club-count="${escapeHtml(String(previewInsulatedClubCount))}" data-preview-changed-area-keys="${escapeHtml((previewChangedAreaKeys || []).join(","))}" data-preview-current-override-club-count="${escapeHtml(String(previewCurrentOverrideClubCount))}" data-preview-projected-override-club-count="${escapeHtml(String(previewProjectedOverrideClubCount))}" data-preview-current-override-area-count="${escapeHtml(String(previewCurrentOverrideAreaCount))}" data-preview-projected-override-area-count="${escapeHtml(String(previewProjectedOverrideAreaCount))}" data-preview-added-area-keys="${escapeHtml((previewAddedAreaKeys || []).join(","))}" data-preview-removed-area-keys="${escapeHtml((previewRemovedAreaKeys || []).join(","))}" data-preview-retained-area-keys="${escapeHtml((previewRetainedAreaKeys || []).join(","))}" data-preview-reducing-clubs="${escapeHtml(JSON.stringify(previewReducingClubs || []))}" data-preview-gaining-clubs="${escapeHtml(JSON.stringify(previewGainingClubs || []))}" data-preview-guardrail-warnings="${escapeHtml(JSON.stringify(previewGuardrailWarnings || []))}" data-preview-cleanup-area-key="${escapeHtml(stagedCleanupAreaKey || "")}" data-preview-cleanup-club-slugs="${escapeHtml((stagedCleanupClubSlugs || []).join(","))}">
      ${renderPolicyField({
        label: "Actor email",
        name: "actorEmail",
        helper: "Used for authorization and the audit trail.",
        input: `<input name="actorEmail" type="email" value="${escapeHtml(actorEmail)}" placeholder="comms@demo-club.local" required />`
      })}
      ${renderPolicyField({
        label: "Default approver",
        name: "defaultApproverRole",
        areaKey: "defaultApproverRole",
        emphasized: focusedInheritanceAreaKey === "defaultApproverRole",
        helper: allowInheritance ? "Leave blank to inherit the organization default." : "Used for normal internal submissions.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Default approver",
          fieldNames: ["defaultApproverRole"],
          allowInheritance
        }),
        input: `<select name="defaultApproverRole">${renderPolicySelectOptions(roleOptions, defaultApprover, {
          allowEmpty: allowInheritance,
          emptyLabel: "Inherit organization default"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Public post approver",
        name: "publicApproverRole",
        areaKey: "publicApproverRole",
        emphasized: focusedInheritanceAreaKey === "publicApproverRole",
        helper: allowInheritance ? "Used when a club override is needed for public visibility." : "Used when a submission targets public visibility.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Public approver",
          fieldNames: ["publicApproverRole"],
          allowInheritance
        }),
        input: `<select name="publicApproverRole">${renderPolicySelectOptions(roleOptions, publicApprover, {
          allowEmpty: allowInheritance,
          emptyLabel: "Inherit organization default"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Medium-risk approver",
        name: "mediumRiskApproverRole",
        areaKey: "mediumRiskApproverRole",
        emphasized: focusedInheritanceAreaKey === "mediumRiskApproverRole",
        helper: allowInheritance ? "Used when a club-specific medium-risk reviewer is needed." : "Used once the review score crosses the medium-risk threshold.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Medium-risk approver",
          fieldNames: ["mediumRiskApproverRole"],
          allowInheritance
        }),
        input: `<select name="mediumRiskApproverRole">${renderPolicySelectOptions(roleOptions, mediumRiskApprover, {
          allowEmpty: allowInheritance,
          emptyLabel: "Inherit organization default"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Agent routing",
        name: "allowAgentRouting",
        areaKey: "allowAgentRouting",
        emphasized: focusedInheritanceAreaKey === "allowAgentRouting",
        helper: allowInheritance ? "Choose inherit to follow the organization setting." : "Allows Hermes to override the local fallback approver role.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Agent routing",
          fieldNames: ["allowAgentRouting"],
          allowInheritance
        }),
        input: `<select name="allowAgentRouting">${renderPolicySelectOptions(booleanOptions, allowAgentRouting === null || allowAgentRouting === undefined ? null : String(Boolean(allowAgentRouting)), {
          allowEmpty: allowInheritance,
          emptyLabel: "Inherit organization default"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Low-risk internal auto-approval",
        name: "autoApproveInternalLowRisk",
        areaKey: "autoApproveInternalLowRisk",
        emphasized: focusedInheritanceAreaKey === "autoApproveInternalLowRisk",
        helper: allowInheritance ? "Choose inherit to fall back to the organization rule." : "Allows low-risk internal posts to skip human review.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Low-risk internal auto-approval",
          fieldNames: ["autoApproveInternalLowRisk"],
          allowInheritance
        }),
        input: `<select name="autoApproveInternalLowRisk">${renderPolicySelectOptions(booleanOptions, autoApproveInternalLowRisk === null || autoApproveInternalLowRisk === undefined ? null : String(Boolean(autoApproveInternalLowRisk)), {
          allowEmpty: allowInheritance,
          emptyLabel: "Inherit organization default"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Auto-approve max risk",
        name: "autoApproveMaxRisk",
        areaKey: "autoApproveMaxRisk",
        emphasized: focusedInheritanceAreaKey === "autoApproveMaxRisk",
        helper: allowInheritance ? "Leave blank to inherit the organization threshold." : "Set the maximum risk score allowed for auto-approval.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Auto-approve max risk",
          fieldNames: ["autoApproveMaxRisk"],
          allowInheritance
        }),
        input: `<input name="autoApproveMaxRisk" type="number" min="0" max="1" step="0.01" value="${escapeHtml(autoApproveMaxRisk)}" placeholder="${allowInheritance ? "Inherit organization threshold" : "0.35"}" />`
      })}
      ${renderPolicyField({
        label: "Auto-approve only these content types",
        name: "autoApprovalAllowedContentTypes",
        areaKey: "autoApprovalRule",
        emphasized: focusedInheritanceAreaKey === "autoApprovalRule",
        helper: "Comma-separated content types. Leave blank to allow any content type that passes the risk threshold.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Auto-approval rule",
          fieldNames: [
            "autoApprovalAllowedContentTypes",
            "autoApprovalBlockedContentTypes"
          ],
          allowInheritance
        }),
        input: `<input name="autoApprovalAllowedContentTypes" type="text" value="${escapeHtml(autoApprovalAllowedContentTypes)}" placeholder="photo, text" />`
      })}
      ${renderPolicyField({
        label: "Never auto-approve these content types",
        name: "autoApprovalBlockedContentTypes",
        helper: "Comma-separated content types that must always stay in human review.",
        input: `<input name="autoApprovalBlockedContentTypes" type="text" value="${escapeHtml(autoApprovalBlockedContentTypes)}" placeholder="video, mixed" />`
      })}
      ${renderPolicyRulePreview("Auto-approval rule", autoApprovalRule)}
      ${renderContentTypeRoleFields({
        baseName: "routingRuleApprover",
        label: "Content-type routing overrides",
        helper: allowInheritance ? "Set club-specific overrides by content type, or leave fields blank to inherit the organization routing rule." : "Override the normal visibility and risk-based approver for a specific content type.",
        roleOptions,
        allowInheritance,
        values: routingContentTypeApprovers,
        areaKey: "routingRule",
        emphasized: focusedInheritanceAreaKey === "routingRule",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Routing rule",
          fieldNames: [
            "routingRuleApproverPhoto",
            "routingRuleApproverVideo",
            "routingRuleApproverText",
            "routingRuleApproverMixed"
          ],
          allowInheritance
        })
      })}
      ${renderPolicyRulePreview("Routing rule", routingRule)}
      ${renderPolicyField({
        label: "Second approval for public posts",
        name: "approvalRuleRequireSecondApproval",
        areaKey: "approvalRule",
        emphasized: focusedInheritanceAreaKey === "approvalRule",
        helper: allowInheritance ? "Leave blank to inherit the organization approval chain." : "Require a second reviewer before public content is published.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Approval rule",
          fieldNames: [
            "approvalRuleRequireSecondApproval",
            "approvalRuleSecondApproverRole",
            "approvalRuleSecondApprovalContentTypes"
          ],
          allowInheritance
        }),
        input: `<select name="approvalRuleRequireSecondApproval">${renderPolicySelectOptions(booleanOptions, approvalRuleSecondApproval, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization rule" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Second approver role",
        name: "approvalRuleSecondApproverRole",
        helper: allowInheritance ? "Leave blank to inherit the organization secondary reviewer." : "Falls back to club admin if left unset.",
        input: `<select name="approvalRuleSecondApproverRole">${renderPolicySelectOptions(roleOptions, approvalRuleSecondApproverRole, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization role" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Second approval content types",
        name: "approvalRuleSecondApprovalContentTypes",
        helper: "Comma-separated content types such as video, mixed. Leave blank to apply the public rule to every content type.",
        input: `<input name="approvalRuleSecondApprovalContentTypes" type="text" value="${escapeHtml(approvalRuleSecondApprovalContentTypes)}" placeholder="video, mixed" />`
      })}
      ${renderPolicyRulePreview("Approval rule", approvalRule)}
      ${renderPolicyField({
        label: "Default publishing destinations",
        name: "publishingRuleDestinations",
        areaKey: "publishingRule",
        emphasized: focusedInheritanceAreaKey === "publishingRule",
        helper: "Comma-separated destination types used when no visibility-specific rule matches.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Publishing rule",
          fieldNames: [
            "publishingRuleDestinations",
            "publishingRuleInternalDestinations",
            "publishingRulePublicDestinations"
          ],
          allowInheritance
        }),
        input: `<input name="publishingRuleDestinations" type="text" value="${escapeHtml(publishingRuleDestinations)}" placeholder="internal_feed, booster_email" />`
      })}
      ${renderPolicyField({
        label: "Internal visibility destinations",
        name: "publishingRuleInternalDestinations",
        helper: "Comma-separated destination types for internal submissions.",
        input: `<input name="publishingRuleInternalDestinations" type="text" value="${escapeHtml(publishingRuleInternalDestinations)}" placeholder="internal_feed" />`
      })}
      ${renderPolicyField({
        label: "Public visibility destinations",
        name: "publishingRulePublicDestinations",
        helper: "Comma-separated destination types for public submissions.",
        input: `<input name="publishingRulePublicDestinations" type="text" value="${escapeHtml(publishingRulePublicDestinations)}" placeholder="internal_feed, booster_email" />`
      })}
      ${renderPolicyRulePreview("Publishing rule", publishingRule)}
      ${renderPolicyField({
        label: "Notification email channel",
        name: "notificationRuleEmail",
        areaKey: "notificationRule",
        emphasized: focusedInheritanceAreaKey === "notificationRule",
        helper: allowInheritance ? "Leave blank to inherit the organization default notification channel." : "Turns submission email updates on or off overall.",
        actionHtml: renderPolicyAreaResetButton({
          areaLabel: "Notification rule",
          fieldNames: [
            "notificationRuleEmail",
            "notificationRulePush",
            "notificationRuleReviewStartedEmail",
            "notificationRuleReviewStartedPush",
            "notificationRulePublishedEmail",
            "notificationRulePublishedPush"
          ],
          allowInheritance
        }),
        input: `<select name="notificationRuleEmail">${renderPolicySelectOptions(booleanOptions, notificationRuleEmail, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization channel" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Notification push channel",
        name: "notificationRulePush",
        helper: allowInheritance ? "Leave blank to inherit the organization default push setting." : "Turns submission push updates on or off overall.",
        input: `<select name="notificationRulePush">${renderPolicySelectOptions(booleanOptions, notificationRulePush, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization channel" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Review started email",
        name: "notificationRuleReviewStartedEmail",
        helper: "Optional event-specific override for the review-started notification.",
        input: `<select name="notificationRuleReviewStartedEmail">${renderPolicySelectOptions(booleanOptions, reviewStartedEmail, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization event rule" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Review started push",
        name: "notificationRuleReviewStartedPush",
        helper: "Optional event-specific override for the review-started notification.",
        input: `<select name="notificationRuleReviewStartedPush">${renderPolicySelectOptions(booleanOptions, reviewStartedPush, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization event rule" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Published email",
        name: "notificationRulePublishedEmail",
        helper: "Optional event-specific override for the published notification.",
        input: `<select name="notificationRulePublishedEmail">${renderPolicySelectOptions(booleanOptions, publishedEmail, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization event rule" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyField({
        label: "Published push",
        name: "notificationRulePublishedPush",
        helper: "Optional event-specific override for the published notification.",
        input: `<select name="notificationRulePublishedPush">${renderPolicySelectOptions(booleanOptions, publishedPush, {
          allowEmpty: true,
          emptyLabel: allowInheritance ? "Inherit organization event rule" : "Leave unset"
        })}</select>`
      })}
      ${renderPolicyRulePreview("Notification rule", notificationRule)}
      <div class="policy-actions">
        <button type="submit" class="button-primary">Save ${escapeHtml(scopeType)} policy</button>
        <button type="button" class="button-secondary" data-preview-policy>Preview ${escapeHtml(scopeType)} draft</button>
        ${
          allowInheritance
            ? `<button type="button" class="button-secondary" data-reset-inheritance>Clear club overrides</button>`
            : ""
        }
        ${
          !allowInheritance && previewScopeType === "organization" && previewAffectedClubCount > 0
            ? `<span class="badge badge-review">Affects ${escapeHtml(String(previewAffectedClubCount))} club${previewAffectedClubCount === 1 ? "" : "s"}</span>`
            : ""
        }
        <span class="subtle policy-status" data-policy-status>Ready</span>
        ${previewScopeType === scopeType ? `<span class="badge badge-review">Previewing draft</span>` : ""}
      </div>
    </form>
  </section>`;
}

function renderEffectivePolicySummary({
  effectivePolicy: policy,
  clubPolicy = {},
  organizationPolicy = {}
}) {
  if (!policy) {
    return `<div class="panel"><h2>No policy loaded</h2><p class="subtle" style="margin-top:8px;">Pick a club slug that exists in the current environment.</p></div>`;
  }

  const defaultApproverSource = describePolicySource({
    clubValue: clubPolicy?.defaultApproverRole,
    organizationValue: organizationPolicy?.defaultApproverRole
  });
  const publicApproverSource = describePolicySource({
    clubValue: clubPolicy?.publicApproverRole,
    organizationValue: organizationPolicy?.publicApproverRole
  });
  const mediumRiskApproverSource = describePolicySource({
    clubValue: clubPolicy?.mediumRiskApproverRole,
    organizationValue: organizationPolicy?.mediumRiskApproverRole
  });
  const autoApproveSource = describePolicySource({
    clubValue: clubPolicy?.autoApproveInternalLowRisk,
    organizationValue: organizationPolicy?.autoApproveInternalLowRisk
  });
  const autoApprovalRuleSource = describePolicySource({
    clubValue: clubPolicy?.autoApprovalRule,
    organizationValue: organizationPolicy?.autoApprovalRule
  });
  const routingRuleSource = describePolicySource({
    clubValue: clubPolicy?.routingRule,
    organizationValue: organizationPolicy?.routingRule
  });
  const approvalRuleSource = describePolicySource({
    clubValue: clubPolicy?.approvalRule,
    organizationValue: organizationPolicy?.approvalRule
  });
  const publishingRuleSource = describePolicySource({
    clubValue: clubPolicy?.publishingRule,
    organizationValue: organizationPolicy?.publishingRule
  });
  const notificationRuleSource = describePolicySource({
    clubValue: clubPolicy?.notificationRule,
    organizationValue: organizationPolicy?.notificationRule
  });

  return `<section class="panel">
    <div class="section-header">
      <div>
        <div class="eyebrow">Effective policy</div>
        <h2>What the worker will do right now</h2>
      </div>
    </div>
    <div class="topline">
      <div class="metric-card">
        <span class="metric-label">Default approver</span>
        <strong>${escapeHtml(formatLabel(policy.defaultApproverRole))}</strong>
        <span class="subtle">${escapeHtml(defaultApproverSource.label)}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Public approver</span>
        <strong>${escapeHtml(formatLabel(policy.publicApproverRole))}</strong>
        <span class="subtle">${escapeHtml(publicApproverSource.label)}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Medium-risk approver</span>
        <strong>${escapeHtml(formatLabel(policy.mediumRiskApproverRole))}</strong>
        <span class="subtle">${escapeHtml(mediumRiskApproverSource.label)}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Auto-approve max risk</span>
        <strong>${escapeHtml(formatPercent(policy.autoApproveMaxRisk))}</strong>
        <span class="subtle">${escapeHtml(autoApproveSource.label)}</span>
      </div>
    </div>
    <div class="badge-row" style="margin-top:14px;">
      ${renderStatusBadge(policy.allowAgentRouting ? "Agent routing enabled" : "Agent routing disabled", policy.allowAgentRouting ? "good" : "neutral")}
      ${renderStatusBadge(policy.autoApproveInternalLowRisk ? "Low-risk internal auto-approve on" : "Low-risk internal auto-approve off", policy.autoApproveInternalLowRisk ? "good" : "neutral")}
    </div>
    <div class="signal-list" style="margin-top:16px;">
      ${renderEffectivePolicyExplainCard({
        label: "Auto-approval rule",
        source: autoApprovalRuleSource,
        summary: summarizeAutoApprovalRule(policy.autoApprovalRule || {})
      })}
      ${renderEffectivePolicyExplainCard({
        label: "Routing rule",
        source: routingRuleSource,
        summary: summarizeContentTypeApprovers(policy.routingRule || {})
      })}
      ${renderEffectivePolicyExplainCard({
        label: "Approval chain",
        source: approvalRuleSource,
        summary: policy.approvalRule?.requireSecondApprovalForPublic
          ? `Public posts need second approval by ${formatLabel(policy.approvalRule?.secondApproverRole || "club_admin")}${formatPolicyList(policy.approvalRule?.secondApprovalContentTypes) ? ` for ${formatPolicyList(policy.approvalRule.secondApprovalContentTypes)}` : ""}.`
          : "No second public approval requirement is active."
      })}
      ${renderEffectivePolicyExplainCard({
        label: "Publishing rule",
        source: publishingRuleSource,
        summary: summarizePublishingRule(policy.publishingRule || {})
      })}
      ${renderEffectivePolicyExplainCard({
        label: "Notification rule",
        source: notificationRuleSource,
        summary: summarizeNotificationRule(policy.notificationRule || {})
      })}
    </div>
  </section>`;
}

function renderPolicyHistoryCard(
  title,
  history,
  emptyLabel,
  {
    clubSlug = "",
    linkVariant = "stack",
    simulationInput = null,
    previewScopeType = null,
    previewDraftPolicy = null
  } = {}
) {
  const items = history?.items || [];
  const content = items.length
    ? items
        .map((item) => {
          const changedFields = Array.isArray(item.metadata?.changedFields)
            ? item.metadata.changedFields
            : [];
          const cleanupSummary =
            item.metadata?.cleanupSummary &&
            typeof item.metadata.cleanupSummary === "object" &&
            !Array.isArray(item.metadata.cleanupSummary)
              ? item.metadata.cleanupSummary
              : null;
          const cleanupAreaKey = String(cleanupSummary?.areaKey || "").trim();
          const cleanupArea =
            trackedPolicyAreaFields.find((area) => area.key === cleanupAreaKey) || null;
          const cleanedClubs = Array.isArray(cleanupSummary?.clubs)
            ? cleanupSummary.clubs
                .map((club) => ({
                  slug: String(club?.slug || "").trim(),
                  name: String(club?.name || club?.slug || "").trim()
                }))
                .filter((club) => club.slug)
            : [];
          const actorLabel = item.actorFullName || item.actorEmail || "Unknown actor";
          const actorEmailSuffix =
            item.actorFullName && item.actorEmail ? ` • ${item.actorEmail}` : "";
          const changedFieldDetails = Array.isArray(item.metadata?.changedFieldDetails)
            ? item.metadata.changedFieldDetails
            : [];
          const changedAreaBadges = changedFields.length
            ? `<div class="badge-row" style="margin-top:10px;">
                ${changedFields
                  .map((field) => {
                    const label = formatPolicyFieldLabel(field);
                    const href =
                      linkVariant === "organization"
                        ? buildWorkflowSettingsLink({
                            clubSlug,
                            clubView: "overrides",
                            clubArea: field,
                            simulationInput,
                            previewScopeType,
                            previewDraftPolicy
                          })
                        : buildWorkflowSettingsLink({
                            clubSlug,
                            simulationInput,
                            previewScopeType,
                            previewDraftPolicy
                          });

                    return `<a class="badge badge-info" href="${href}">${escapeHtml(
                      label
                    )}</a>`;
                  })
                  .join("")}
              </div>`
            : "";
          const followUpCopy = changedFields.length
            ? linkVariant === "organization"
              ? "Review the changed organization areas across clubs, including both remaining exceptions and clubs inheriting the default."
              : "Open the club stack to confirm whether these overrides should stay."
            : "No changed-area detail was recorded for this update.";
          const followUpLink =
            changedFields.length && linkVariant !== "organization"
              ? `<p style="margin-top:10px;"><a class="quick-link" href="${escapeHtml(
                  buildWorkflowSettingsLink({
                    clubSlug,
                    simulationInput,
                    previewScopeType,
                    previewDraftPolicy
                  })
                )}">Open this club policy stack</a></p>`
              : "";
          const organizationFollowUpLinks =
            changedFields.length && linkVariant === "organization"
              ? `<div class="badge-row" style="margin-top:10px; align-items:flex-start;">
                  ${changedFields
                    .map((field) => {
                      const label = formatPolicyFieldLabel(field).toLowerCase();
                      return `<a class="quick-link" href="${buildWorkflowSettingsLink({
                        clubSlug,
                        clubView: "overrides",
                        clubArea: field,
                        simulationInput,
                        previewScopeType,
                        previewDraftPolicy
                      })}">Review ${escapeHtml(label)} exceptions</a>
                      <a class="quick-link" href="${buildWorkflowSettingsLink({
                        clubSlug,
                        clubView: "inheriting",
                        clubArea: field,
                        simulationInput,
                        previewScopeType,
                        previewDraftPolicy
                      })}">Review ${escapeHtml(label)} inheriting clubs</a>`;
                    })
                    .join("")}
                </div>`
              : "";
          const changeDetailRows = changedFieldDetails.length
            ? `<div class="summary-stack" style="margin-top:12px;">
                ${changedFieldDetails
                  .map(
                    (detail) => `<div class="summary-item">
                      <strong>${escapeHtml(formatPolicyFieldLabel(detail.field))}</strong>
                      <p class="subtle" style="margin-top:6px;">Before: ${escapeHtml(
                        summarizePolicyHistoryValue(detail.previousValue)
                      )}</p>
                      <p class="subtle" style="margin-top:6px;">After: ${escapeHtml(
                        summarizePolicyHistoryValue(detail.nextValue)
                      )}</p>
                    </div>`
                  )
                  .join("")}
              </div>`
            : "";
          const cleanupSummaryCard =
            cleanupArea && cleanedClubs.length
              ? `<div class="summary-stack" style="margin-top:12px;">
                  <div class="summary-item">
                    <strong>Cleanup staged into this save</strong>
                    <p class="subtle" style="margin-top:6px;">${escapeHtml(
                      `${cleanupArea.label} exceptions were cleared for ${cleanedClubs.length} club${
                        cleanedClubs.length === 1 ? "" : "s"
                      } as part of this organization update.`
                    )}</p>
                    <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
                      ${cleanedClubs
                        .map(
                          (club) => `<span class="badge badge-good">${escapeHtml(
                            club.name || club.slug
                          )}</span>`
                        )
                        .join("")}
                    </div>
                    <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
                      <a class="quick-link" href="${buildWorkflowSettingsLink({
                        clubSlug,
                        clubView: "overrides",
                        clubArea: cleanupArea.key,
                        simulationInput,
                        previewScopeType,
                        previewDraftPolicy
                      })}">Review remaining ${escapeHtml(
                        cleanupArea.label.toLowerCase()
                      )} exceptions</a>
                      <a class="quick-link" href="${buildWorkflowSettingsLink({
                        clubSlug,
                        clubView: "inheriting",
                        clubArea: cleanupArea.key,
                        simulationInput,
                        previewScopeType,
                        previewDraftPolicy
                      })}">Review inheriting ${escapeHtml(
                        cleanupArea.label.toLowerCase()
                      )} clubs</a>
                    </div>
                  </div>
                </div>`
              : "";

          return `<div class="summary-item">
            <div class="badge-row" style="justify-content:space-between; margin-bottom:6px;">
              <strong>${escapeHtml(actorLabel)}</strong>
              <span class="subtle">${escapeHtml(formatRelativeTime(item.createdAt))}</span>
            </div>
            <p class="subtle">${escapeHtml(item.action || "workflow_policy.updated")}${escapeHtml(actorEmailSuffix)}</p>
            <p style="margin-top:6px;">Changed ${escapeHtml(
              changedFields.length === 1 ? "1 area" : `${changedFields.length} areas`
            )}: ${escapeHtml(
              changedFields.length
                ? changedFields.map((field) => formatPolicyFieldLabel(field)).join(", ")
                : "No field summary recorded"
            )}</p>
            <p class="subtle" style="margin-top:8px;">${escapeHtml(followUpCopy)}</p>
            ${changedAreaBadges}
            ${organizationFollowUpLinks}
            ${changeDetailRows}
            ${cleanupSummaryCard}
            ${followUpLink}
          </div>`;
        })
        .join("")
    : `<p class="subtle">${escapeHtml(emptyLabel)}</p>`;

  return `<div class="panel" style="background: rgba(255,255,255,0.72);">
    <h3>${escapeHtml(title)}</h3>
    <div class="summary-stack" style="margin-top:12px;">${content}</div>
  </div>`;
}

function renderPolicyHistorySection({
  organizationHistory,
  clubHistory,
  selectedClubSlug = "",
  simulationInput = null,
  previewScopeType = null,
  previewDraftPolicy = null
}) {
  if (!organizationHistory && !clubHistory) {
    return "";
  }

  return `<section class="panel">
    <div class="section-header">
      <div>
        <div class="eyebrow">Policy history</div>
        <h2>Recent workflow policy changes</h2>
        <p class="subtle" style="margin-top:8px;">Use this to confirm who last changed the organization default or the club override layer.</p>
      </div>
    </div>
    <div class="footer-panels" style="margin-top:0;">
      ${renderPolicyHistoryCard(
        "Organization changes",
        organizationHistory,
        "No organization policy changes recorded yet.",
        {
          clubSlug: selectedClubSlug,
          linkVariant: "organization",
          simulationInput,
          previewScopeType,
          previewDraftPolicy
        }
      )}
      ${renderPolicyHistoryCard(
        "Club changes",
        clubHistory,
        "No club-specific policy changes recorded yet.",
        {
          clubSlug: selectedClubSlug,
          linkVariant: "club",
          simulationInput,
          previewScopeType,
          previewDraftPolicy
        }
      )}
    </div>
  </section>`;
}

const trackedPolicyAreaFields = [
  { key: "defaultApproverRole", label: "Default approver" },
  { key: "publicApproverRole", label: "Public approver" },
  { key: "mediumRiskApproverRole", label: "Medium-risk approver" },
  { key: "allowAgentRouting", label: "Agent routing" },
  { key: "autoApproveInternalLowRisk", label: "Low-risk internal auto-approval" },
  { key: "autoApproveMaxRisk", label: "Auto-approve max risk" },
  { key: "autoApprovalRule", label: "Auto-approval rule" },
  { key: "routingRule", label: "Routing rule" },
  { key: "approvalRule", label: "Approval rule" },
  { key: "publishingRule", label: "Publishing rule" },
  { key: "notificationRule", label: "Notification rule" }
];

function buildClubOverrideSummary({ clubPolicy = {}, organizationPolicy = {} }) {
  const overridden = trackedPolicyAreaFields.filter(({ key }) => {
    const clubValue = clubPolicy?.[key];
    const orgValue = organizationPolicy?.[key];

    if (clubValue === null || clubValue === undefined) {
      return false;
    }

    return JSON.stringify(clubValue) !== JSON.stringify(orgValue ?? null);
  });

  return {
    total: trackedPolicyAreaFields.length,
    overridden,
    inheritedCount: trackedPolicyAreaFields.length - overridden.length
  };
}

function listChangedPolicyAreas({ livePolicy = {}, previewPolicy = {} }) {
  return trackedPolicyAreaFields.filter(({ key }) => {
    return JSON.stringify(livePolicy?.[key] ?? null) !== JSON.stringify(previewPolicy?.[key] ?? null);
  });
}

function buildOrganizationOverrideAreaSummary(clubs = []) {
  return trackedPolicyAreaFields
    .map((area) => {
      const clubsMatchingArea = clubs.filter((club) =>
        Array.isArray(club.overrideSummary?.overriddenFields)
          ? club.overrideSummary.overriddenFields.includes(area.label)
          : false
      );

      return {
        ...area,
        clubCount: clubsMatchingArea.length,
        clubNames: clubsMatchingArea.map((club) => club.name)
      };
    })
    .filter((area) => area.clubCount > 0)
    .sort(
      (left, right) =>
        right.clubCount - left.clubCount || left.label.localeCompare(right.label)
    );
}

function buildOrganizationGovernanceSummary(clubs = []) {
  const totalClubs = clubs.length;

  return trackedPolicyAreaFields
    .map((area) => {
      const matchingClubs = clubs.filter((club) =>
        Array.isArray(club.overrideSummary?.overriddenFields)
          ? club.overrideSummary.overriddenFields.includes(area.label)
          : false
      );
      const overrideClubCount = matchingClubs.length;
      const posture =
        overrideClubCount === 0
          ? "Centralized"
          : overrideClubCount === totalClubs && totalClubs > 0
            ? "Club-defined"
            : overrideClubCount >= Math.ceil(totalClubs / 2)
              ? "Fragmented"
              : "Watchlist";

      return {
        ...area,
        overrideClubCount,
        matchingClubs,
        posture
      };
    })
    .sort(
      (left, right) =>
        right.overrideClubCount - left.overrideClubCount ||
        left.label.localeCompare(right.label)
    );
}

function buildWorkflowSettingsLink({
  clubSlug = "",
  clubView = null,
  clubArea = null,
  previewScopeType = null,
  previewDraftPolicy = null,
  previewResetArea = null,
  previewCleanupArea = null,
  previewCleanupClubs = null,
  simulationInput = null
} = {}) {
  const params = new URLSearchParams();

  if (clubSlug) {
    params.set("clubSlug", clubSlug);
  }
  if (clubView) {
    params.set("clubView", clubView);
  }
  if (clubArea) {
    params.set("clubArea", clubArea);
  }
  if (previewScopeType) {
    params.set("previewScopeType", previewScopeType);
  }
  if (previewDraftPolicy) {
    params.set("previewDraftPolicy", previewDraftPolicy);
  }
  if (previewResetArea) {
    params.set("previewResetArea", previewResetArea);
  }
  if (previewCleanupArea) {
    params.set("previewCleanupArea", previewCleanupArea);
  }
  if (Array.isArray(previewCleanupClubs) && previewCleanupClubs.length) {
    params.set("previewCleanupClubs", previewCleanupClubs.join(","));
  }
  if (simulationInput?.contentType) {
    params.set("simulationContentType", String(simulationInput.contentType));
  }
  if (simulationInput?.visibilityTarget) {
    params.set("simulationVisibilityTarget", String(simulationInput.visibilityTarget));
  }
  if (simulationInput?.riskScore !== null && simulationInput?.riskScore !== undefined) {
    params.set("simulationRiskScore", String(simulationInput.riskScore));
  }
  if (
    simulationInput?.moderationFlagged !== null &&
    simulationInput?.moderationFlagged !== undefined
  ) {
    params.set(
      "simulationModerationFlagged",
      String(Boolean(simulationInput.moderationFlagged))
    );
  }
  if (simulationInput?.agentSuggestedApproverRole) {
    params.set(
      "simulationAgentSuggestedApproverRole",
      String(simulationInput.agentSuggestedApproverRole)
    );
  }

  return `/workflow-settings?${params.toString()}`;
}

function buildOrganizationDraftImpact({
  organizationPolicy,
  previewOrganizationPolicy,
  organizationDirectory,
  clubPolicyMap = null
}) {
  const changedAreas = listChangedPolicyAreas({
    livePolicy: organizationPolicy?.organizationPolicy || {},
    previewPolicy: previewOrganizationPolicy || {}
  });

  const clubImpacts = (organizationDirectory?.clubs || []).map((club) => {
    const overriddenFields = clubPolicyMap
      ? buildClubOverrideSummary({
          clubPolicy: clubPolicyMap?.[club.slug]?.clubPolicy || {},
          organizationPolicy: previewOrganizationPolicy || {}
        }).overridden.map((area) => area.label)
      : Array.isArray(club.overrideSummary?.overriddenFields)
        ? club.overrideSummary.overriddenFields
        : [];
    const impactedAreas = changedAreas.filter(
      (area) => !overriddenFields.includes(area.label)
    );

    return {
      ...club,
      impactedAreas,
      insulatedAreas: changedAreas.filter((area) => overriddenFields.includes(area.label))
    };
  });

  return {
    changedAreas,
    clubImpacts,
    affectedClubs: clubImpacts.filter((club) => club.impactedAreas.length),
    insulatedClubs: clubImpacts.filter((club) => !club.impactedAreas.length)
  };
}

function buildOrganizationDraftAreaImpactSummary({ changedAreas = [], clubImpacts = [] }) {
  return changedAreas.map((area) => {
    const affectedClubs = clubImpacts.filter((club) =>
      club.impactedAreas.some((candidate) => candidate.key === area.key)
    );
    const insulatedClubs = clubImpacts.filter((club) =>
      club.insulatedAreas.some((candidate) => candidate.key === area.key)
    );

    return {
      ...area,
      affectedClubs,
      insulatedClubs
    };
  });
}

function buildRemainingExceptionCleanupItems({
  clubs = [],
  changedAreas = [],
  clubPolicyMap = null,
  organizationPolicy = {}
}) {
  const changedAreaLabels = new Set(changedAreas.map((area) => area.label));
  const changedAreaMap = new Map(changedAreas.map((area) => [area.label, area]));

  return clubs
    .map((club) => {
      const overriddenFields = clubPolicyMap
        ? buildClubOverrideSummary({
            clubPolicy: clubPolicyMap?.[club.slug]?.clubPolicy || {},
            organizationPolicy
          }).overridden.map((area) => area.label)
        : Array.isArray(club.overrideSummary?.overriddenFields)
          ? club.overrideSummary.overriddenFields
          : [];
      const remainingAreas = overriddenFields
        .filter((label) => changedAreaLabels.has(label))
        .map((label) => changedAreaMap.get(label))
        .filter(Boolean);

      return {
        club,
        remainingAreas
      };
    })
    .filter((item) => item.remainingAreas.length > 0)
    .sort(
      (left, right) =>
        right.remainingAreas.length - left.remainingAreas.length ||
        Number(right.club.overrideSummary?.overrideCount || 0) -
          Number(left.club.overrideSummary?.overrideCount || 0) ||
        String(left.club.name || "").localeCompare(String(right.club.name || ""))
    );
}

function buildOrganizationDirectoryPreview({
  organizationDirectory,
  organizationPolicy = {},
  clubPolicyMap = {}
}) {
  if (!organizationDirectory) {
    return null;
  }

  return {
    ...organizationDirectory,
    clubs: (organizationDirectory.clubs || []).map((club) => {
      const summary = buildClubOverrideSummary({
        clubPolicy: clubPolicyMap?.[club.slug]?.clubPolicy || {},
        organizationPolicy
      });

      return {
        ...club,
        overrideSummary: {
          overrideCount: summary.overridden.length,
          overriddenFields: summary.overridden.map((area) => area.label)
        }
      };
    })
  };
}

function buildExceptionCleanupAreaItems(items = []) {
  const areaMap = new Map();

  for (const item of items) {
    for (const area of item.remainingAreas || []) {
      if (!areaMap.has(area.key)) {
        areaMap.set(area.key, {
          area,
          clubs: []
        });
      }

      areaMap.get(area.key).clubs.push(item.club);
    }
  }

  return Array.from(areaMap.values()).sort(
    (left, right) =>
      right.clubs.length - left.clubs.length ||
      String(left.area?.label || "").localeCompare(String(right.area?.label || ""))
  );
}

function buildOrganizationOverrideBurdenSummaryFromClubPolicyMap({
  organizationDirectory,
  organizationPolicy = {},
  clubPolicyMap = {}
}) {
  const clubs = organizationDirectory?.clubs || [];
  const comparisons = clubs.map((club) => {
    const clubPolicy = clubPolicyMap?.[club.slug]?.clubPolicy || {};
    const summary = buildClubOverrideSummary({
      clubPolicy,
      organizationPolicy
    });

    return {
      club,
      overrideCount: summary.overridden.length
    };
  });

  return {
    currentOverrideClubCount: comparisons.filter((item) => item.overrideCount > 0).length,
    currentOverrideAreaCount: comparisons.reduce(
      (sum, item) => sum + item.overrideCount,
      0
    ),
    comparisons
  };
}

function buildInheritedClubPolicyPreview(policy = {}, areaKey = "") {
  if (!areaKey) {
    return policy || {};
  }

  return {
    ...(policy || {}),
    [areaKey]: null
  };
}

function renderExceptionCleanupSummary({
  title,
  subtitle,
  items = [],
  selectedClubSlug = "",
  organizationSlug = "",
  previewScopeType = null,
  previewDraftPolicy = null,
  simulationInput = null,
  includePreviewInheritanceLinks = false,
  includeBulkCleanupControls = false,
  stagedCleanupAreaKey = null,
  stagedCleanupClubSlugs = []
}) {
  if (!items.length) {
    return "";
  }

  const cleanupAreaItems = includeBulkCleanupControls
    ? buildExceptionCleanupAreaItems(items)
    : [];

  return `<div class="summary-stack" style="margin-top:16px;">
    <div class="summary-item" style="background: rgba(255,255,255,0.68);">
      <strong>${escapeHtml(title)}</strong>
      <p class="subtle" style="margin-top:6px;">${escapeHtml(subtitle)}</p>
    </div>
    ${
      cleanupAreaItems.length
        ? `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
            <strong>Bulk cleanup by area</strong>
            <p class="subtle" style="margin-top:6px;">Choose the clubs that should stop overriding one changed organization area, then apply the inherited default in one save flow.</p>
            <div class="summary-stack" style="margin-top:12px;">
              ${cleanupAreaItems
                .map(
                  (item) => `<form class="${
                    previewScopeType === "organization"
                      ? "workflow-bulk-preview-form"
                      : "workflow-bulk-inherit-form"
                  } summary-item" data-organization-slug="${escapeHtml(
                    organizationSlug
                  )}" ${
                    previewScopeType === "organization"
                      ? `method="GET" action="/workflow-settings" data-preview-draft-policy="${escapeHtml(
                          previewDraftPolicy || ""
                        )}" data-selected-club-slug="${escapeHtml(selectedClubSlug)}"`
                      : ""
                  } style="background: rgba(255,255,255,0.72);">
                    ${
                      previewScopeType === "organization"
                        ? `<input type="hidden" name="clubSlug" value="${escapeHtml(
                            selectedClubSlug
                          )}" />
                          <input type="hidden" name="previewScopeType" value="organization" />
                          <input type="hidden" name="previewDraftPolicy" value="${escapeHtml(
                            previewDraftPolicy || ""
                          )}" />`
                        : ""
                    }
                    <input type="hidden" name="areaKey" value="${escapeHtml(
                      item.area.key
                    )}" />
                    <input type="hidden" name="returnClubSlug" value="${escapeHtml(
                      selectedClubSlug
                    )}" />
                    ${
                      previewScopeType === "organization"
                        ? `<input type="hidden" name="previewCleanupArea" value="${escapeHtml(
                            item.area.key
                          )}" />`
                        : ""
                    }
                    ${
                      simulationInput?.contentType
                        ? `<input type="hidden" name="simulationContentType" value="${escapeHtml(
                            String(simulationInput.contentType)
                          )}" />`
                        : ""
                    }
                    ${
                      simulationInput?.visibilityTarget
                        ? `<input type="hidden" name="simulationVisibilityTarget" value="${escapeHtml(
                            String(simulationInput.visibilityTarget)
                          )}" />`
                        : ""
                    }
                    ${
                      simulationInput?.riskScore !== null &&
                      simulationInput?.riskScore !== undefined
                        ? `<input type="hidden" name="simulationRiskScore" value="${escapeHtml(
                            String(simulationInput.riskScore)
                          )}" />`
                        : ""
                    }
                    ${
                      simulationInput?.moderationFlagged !== null &&
                      simulationInput?.moderationFlagged !== undefined
                        ? `<input type="hidden" name="simulationModerationFlagged" value="${escapeHtml(
                            String(Boolean(simulationInput.moderationFlagged))
                          )}" />`
                        : ""
                    }
                    ${
                      simulationInput?.agentSuggestedApproverRole
                        ? `<input type="hidden" name="simulationAgentSuggestedApproverRole" value="${escapeHtml(
                            String(simulationInput.agentSuggestedApproverRole)
                          )}" />`
                        : ""
                    }
                    <div class="badge-row" style="justify-content:space-between; margin-bottom:6px;">
                      <strong>${escapeHtml(item.area.label)}</strong>
                      ${renderStatusBadge(
                        previewScopeType === "organization" &&
                          stagedCleanupAreaKey === item.area.key &&
                          stagedCleanupClubSlugs.length
                          ? `${stagedCleanupClubSlugs.length} staged`
                          : `${item.clubs.length} selected by default`,
                        previewScopeType === "organization" &&
                          stagedCleanupAreaKey === item.area.key &&
                          stagedCleanupClubSlugs.length
                          ? "info"
                          : "review"
                      )}
                    </div>
                    <p class="subtle">Apply the organization ${escapeHtml(
                      item.area.label.toLowerCase()
                    )} default to${
                      previewScopeType === "organization"
                        ? " in this preview"
                        : ""
                    }:</p>
                    <div class="summary-stack" style="margin-top:10px;">
                      ${item.clubs
                        .map(
                          (club) => `<label class="badge-row" style="justify-content:flex-start; gap:8px;">
                            <input type="checkbox" name="clubSlugs" value="${escapeHtml(
                              club.slug || ""
                            )}" ${
                              previewScopeType === "organization" &&
                              stagedCleanupAreaKey === item.area.key &&
                              stagedCleanupClubSlugs.length
                                ? stagedCleanupClubSlugs.includes(club.slug || "")
                                  ? "checked"
                                  : ""
                                : "checked"
                            } />
                            <span>${escapeHtml(club.name)}</span>
                            <span class="subtle">${escapeHtml(club.slug || "")}</span>
                          </label>`
                        )
                        .join("")}
                    </div>
                    <div class="policy-actions" style="margin-top:12px;">
                      <button type="submit" class="button-secondary">${
                        previewScopeType === "organization"
                          ? `Stage ${escapeHtml(
                              item.area.label.toLowerCase()
                            )} cleanup in preview`
                          : `Apply org ${escapeHtml(
                              item.area.label.toLowerCase()
                            )} to selected clubs`
                      }</button>
                      ${
                        previewScopeType === "organization" &&
                        stagedCleanupAreaKey === item.area.key &&
                        stagedCleanupClubSlugs.length
                          ? `<a class="quick-link" href="${buildWorkflowSettingsLink({
                              clubSlug: selectedClubSlug,
                              previewScopeType: "organization",
                              previewDraftPolicy,
                              simulationInput
                            })}">Clear staged cleanup</a>`
                          : ""
                      }
                      <span class="subtle" data-bulk-status>Ready</span>
                    </div>
                  </form>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }
    ${items
      .map((item) => {
        const firstArea = item.remainingAreas[0] || null;
        return `<div class="summary-item">
          <div class="badge-row" style="justify-content:space-between; margin-bottom:6px;">
            <strong>${escapeHtml(item.club.name)}</strong>
            ${renderStatusBadge(
              `${item.remainingAreas.length} remaining area${
                item.remainingAreas.length === 1 ? "" : "s"
              }`,
              "review"
            )}
          </div>
          <p class="subtle">${escapeHtml(item.club.slug || "")}</p>
          <p style="margin-top:6px;">${escapeHtml(
            `Still overriding changed areas: ${item.remainingAreas
              .map((area) => area.label)
              .join(", ")}`
          )}</p>
          <div class="badge-row" style="margin-top:10px;">
            ${item.remainingAreas
              .map(
                (area) => `<a class="badge badge-info" href="${buildWorkflowSettingsLink({
                  clubSlug: selectedClubSlug,
                  clubView: "overrides",
                  clubArea: area.key,
                  previewScopeType,
                  previewDraftPolicy,
                  simulationInput
                })}">${escapeHtml(area.label)}</a>`
              )
              .join("")}
          </div>
          ${
            includePreviewInheritanceLinks
              ? `<div class="badge-row" style="margin-top:10px;">
                  ${item.remainingAreas
                    .map(
                      (area) => `<a class="quick-link" href="${buildWorkflowSettingsLink({
                        clubSlug: item.club.slug || "",
                        previewResetArea: area.key,
                        simulationInput
                      })}${buildPolicyAreaAnchor(area.key)}">Preview inheriting ${escapeHtml(
                        area.label.toLowerCase()
                      )}</a>`
                    )
                    .join("")}
                </div>`
              : ""
          }
          <p style="margin-top:10px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
            clubSlug: item.club.slug || "",
            simulationInput,
            previewScopeType,
            previewDraftPolicy
          })}">Open ${escapeHtml(item.club.name)} policy stack</a></p>
          ${
            firstArea
              ? `<p style="margin-top:6px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
                  clubSlug: selectedClubSlug,
                  clubView: "overrides",
                  clubArea: firstArea.key,
                  previewScopeType,
                  previewDraftPolicy,
                  simulationInput
                })}">Review ${escapeHtml(firstArea.label.toLowerCase())} exceptions</a></p>`
              : ""
          }
        </div>`;
      })
      .join("")}
  </div>`;
}

async function fetchOrganizationClubPolicyMap({
  organizationDirectory,
  selectedClubSlug,
  selectedClubPolicy
}) {
  const clubs = organizationDirectory?.clubs || [];
  const entries = await Promise.all(
    clubs.map(async (club) => {
      if (club.slug === selectedClubSlug && selectedClubPolicy) {
        return [club.slug, selectedClubPolicy];
      }

      const response = await fetchJson(
        `/workflow-policies/clubs/${encodeURIComponent(club.slug)}`
      );
      return [club.slug, response];
    })
  );

  return Object.fromEntries(entries);
}

function buildOrganizationDraftOverrideBurdenSummary({
  organizationDirectory,
  organizationPolicy,
  previewOrganizationPolicy,
  clubPolicyMap = {}
}) {
  const clubs = organizationDirectory?.clubs || [];
  const liveOrganizationPolicy = organizationPolicy?.organizationPolicy || {};
  const nextOrganizationPolicy = previewOrganizationPolicy || {};
  const comparisons = clubs.map((club) => {
    const clubPolicy = clubPolicyMap?.[club.slug]?.clubPolicy || {};
    const liveSummary = buildClubOverrideSummary({
      clubPolicy,
      organizationPolicy: liveOrganizationPolicy
    });
    const previewSummary = buildClubOverrideSummary({
      clubPolicy,
      organizationPolicy: nextOrganizationPolicy
    });

    return {
      club,
      liveOverrideCount: liveSummary.overridden.length,
      previewOverrideCount: previewSummary.overridden.length
    };
  });

  return {
    currentOverrideClubCount: comparisons.filter((item) => item.liveOverrideCount > 0).length,
    projectedOverrideClubCount: comparisons.filter((item) => item.previewOverrideCount > 0).length,
    currentOverrideAreaCount: comparisons.reduce(
      (sum, item) => sum + item.liveOverrideCount,
      0
    ),
    projectedOverrideAreaCount: comparisons.reduce(
      (sum, item) => sum + item.previewOverrideCount,
      0
    ),
    clubsReducingOverrides: comparisons.filter(
      (item) => item.previewOverrideCount < item.liveOverrideCount
    ),
    clubsGainingOverrides: comparisons.filter(
      (item) => item.previewOverrideCount > item.liveOverrideCount
    ),
    comparisons
  };
}

function renderOrganizationDraftImpactSummary({
  previewScopeType,
  organizationPolicy,
  previewOrganizationPolicy,
  organizationDirectory,
  clubPolicyMap = null,
  selectedClubSlug = "",
  previewCleanupAreaKey = null,
  previewCleanupClubSlugs = [],
  overrideBurdenSummary = null,
  simulationInput = null
}) {
  if (previewScopeType !== "organization") {
    return "";
  }

  const {
    changedAreas,
    clubImpacts,
    affectedClubs,
    insulatedClubs
  } = buildOrganizationDraftImpact({
    organizationPolicy,
    previewOrganizationPolicy,
    organizationDirectory,
    clubPolicyMap
  });
  const areaImpactSummary = buildOrganizationDraftAreaImpactSummary({
    changedAreas,
    clubImpacts
  });
  const cleanupItems = buildRemainingExceptionCleanupItems({
    clubs: organizationDirectory?.clubs || [],
    changedAreas,
    clubPolicyMap,
    organizationPolicy: previewOrganizationPolicy || {}
  });

  if (!changedAreas.length) {
    return `<section class="panel">
      <div class="section-header">
        <div>
          <div class="eyebrow">Organization rollout impact</div>
          <h2>No club rollout impact detected yet</h2>
          <p class="subtle" style="margin-top:8px;">This organization draft does not currently change any top-level policy area from the live organization default.</p>
        </div>
      </div>
    </section>`;
  }

  const clubRows = clubImpacts.length
    ? clubImpacts
        .map((club) => {
          const impactCopy = club.impactedAreas.length
            ? `${club.impactedAreas.length} impacted area${club.impactedAreas.length === 1 ? "" : "s"}`
            : "Insulated by club overrides";
          const impactAreaLinks = club.impactedAreas.length
            ? `<div class="badge-row" style="margin-top:10px;">
                ${club.impactedAreas
                  .map(
                    (area) => `<a class="quick-link" href="${buildWorkflowSettingsLink({
                      clubSlug: selectedClubSlug,
                      clubView: "overrides",
                      clubArea: area.key,
                      previewScopeType: "organization",
                      previewDraftPolicy: JSON.stringify(previewOrganizationPolicy || {}),
                      simulationInput
                    })}">Review ${escapeHtml(area.label.toLowerCase())} rollout</a>`
                  )
                  .join("")}
              </div>`
            : "";
          const insulatedAreaLinks = !club.impactedAreas.length && club.insulatedAreas.length
            ? `<div class="badge-row" style="margin-top:10px;">
                ${club.insulatedAreas
                  .map(
                    (area) => `<a class="quick-link" href="${buildWorkflowSettingsLink({
                      clubSlug: selectedClubSlug,
                      clubView: "overrides",
                      clubArea: area.key,
                      previewScopeType: "organization",
                      previewDraftPolicy: JSON.stringify(previewOrganizationPolicy || {}),
                      simulationInput
                    })}">Review ${escapeHtml(area.label.toLowerCase())} shielding override</a>`
                  )
                  .join("")}
              </div>`
            : "";

          return `<div class="summary-item">
            <div class="badge-row" style="justify-content:space-between; margin-bottom:6px;">
              <strong>${escapeHtml(club.name)}</strong>
              ${renderStatusBadge(
                club.impactedAreas.length ? impactCopy : "No inherited change",
                club.impactedAreas.length ? "review" : "good"
              )}
            </div>
            <p class="subtle">${escapeHtml(club.slug)}</p>
            <p style="margin-top:6px;">${escapeHtml(
              club.impactedAreas.length
                ? `Inherited from this org draft: ${club.impactedAreas
                    .map((area) => area.label)
                    .join(", ")}`
                : `This club already overrides every changed organization area: ${club.insulatedAreas
                    .map((area) => area.label)
                    .join(", ")}.`
            )}</p>
            ${impactAreaLinks}
            ${insulatedAreaLinks}
            <p style="margin-top:8px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
              clubSlug: club.slug || "",
              simulationInput,
              previewScopeType: "organization",
              previewDraftPolicy: JSON.stringify(previewOrganizationPolicy || {})
            })}">Open ${escapeHtml(club.name)} policy stack</a></p>
          </div>`;
        })
        .join("")
    : `<p class="subtle">No clubs are linked to this organization yet.</p>`;
  const areaRows = areaImpactSummary.length
    ? areaImpactSummary
        .map((area) => `<div class="summary-item">
          <div class="badge-row" style="justify-content:space-between; margin-bottom:6px;">
            <strong>${escapeHtml(area.label)}</strong>
            ${renderStatusBadge(
              `${area.affectedClubs.length} affected / ${area.insulatedClubs.length} insulated`,
              area.affectedClubs.length ? "review" : "good"
            )}
          </div>
          <p class="subtle">${
            area.affectedClubs.length
              ? escapeHtml(
                  `Inherited by: ${area.affectedClubs.map((club) => club.name).join(", ")}`
                )
              : "No clubs currently inherit this changed area."
          }</p>
          <p class="subtle" style="margin-top:6px;">${
            area.insulatedClubs.length
              ? escapeHtml(
                  `Shielded by overrides: ${area.insulatedClubs.map((club) => club.name).join(", ")}`
                )
              : "No clubs are shielding themselves from this changed area yet."
          }</p>
          <div class="badge-row" style="margin-top:10px;">
            <a class="quick-link" href="${buildWorkflowSettingsLink({
              clubSlug: selectedClubSlug,
              clubView: "overrides",
              clubArea: area.key,
              previewScopeType: "organization",
              previewDraftPolicy: JSON.stringify(previewOrganizationPolicy || {}),
              simulationInput
            })}">Review ${escapeHtml(area.label.toLowerCase())} across clubs</a>
          </div>
        </div>`)
        .join("")
    : "";
  const burdenDeltaRows = overrideBurdenSummary
    ? [
        {
          title: "Clubs reducing override burden",
          items: overrideBurdenSummary.clubsReducingOverrides,
          empty: "No clubs would reduce override burden from this draft.",
          verb: "reduces"
        },
        {
          title: "Clubs gaining override burden",
          items: overrideBurdenSummary.clubsGainingOverrides,
          empty: "No clubs would gain new override burden from this draft.",
          verb: "gains"
        }
      ]
        .map(
          (group) => `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
            <strong>${escapeHtml(group.title)}</strong>
            <div class="summary-stack" style="margin-top:12px;">
              ${
                group.items.length
                  ? group.items
                      .map(
                        (item) => `<div class="summary-item">
                          <strong>${escapeHtml(item.club.name)}</strong>
                          <p class="subtle" style="margin-top:6px;">${escapeHtml(
                            `${item.liveOverrideCount} -> ${item.previewOverrideCount} override areas`
                          )}</p>
                          <p class="subtle" style="margin-top:6px;">${escapeHtml(
                            `${item.club.name} ${group.verb} ${Math.abs(item.previewOverrideCount - item.liveOverrideCount)} override area${Math.abs(item.previewOverrideCount - item.liveOverrideCount) === 1 ? "" : "s"} under this draft.`
                          )}</p>
                          <p style="margin-top:8px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
                            clubSlug: item.club.slug || "",
                            simulationInput,
                            previewScopeType: "organization",
                            previewDraftPolicy: JSON.stringify(previewOrganizationPolicy || {})
                          })}">Open ${escapeHtml(item.club.name)} policy stack</a></p>
                        </div>`
                      )
                      .join("")
                  : `<p class="subtle">${escapeHtml(group.empty)}</p>`
              }
            </div>
          </div>`
        )
        .join("")
    : "";

  return `<section class="panel">
    <div class="section-header">
      <div>
        <div class="eyebrow">Organization rollout impact</div>
        <h2>Which clubs this organization draft will change</h2>
        <p class="subtle" style="margin-top:8px;">This preview compares the live organization default against the unsaved organization draft and maps the changed areas onto each club's override footprint.</p>
      </div>
    </div>
    <div class="topline">
      <div class="metric-card">
        <span class="metric-label">Changed org areas</span>
        <strong>${escapeHtml(String(changedAreas.length))}</strong>
        <span class="subtle">${escapeHtml(changedAreas.map((area) => area.label).join(", "))}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Clubs affected</span>
        <strong>${escapeHtml(String(affectedClubs.length))}</strong>
        <span class="subtle">Clubs inheriting at least one changed area</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Clubs insulated</span>
        <strong>${escapeHtml(String(insulatedClubs.length))}</strong>
        <span class="subtle">Clubs already overriding every changed area</span>
      </div>
    </div>
    ${
      overrideBurdenSummary
        ? `<div class="topline" style="margin-top:12px;">
            <div class="metric-card">
              <span class="metric-label">Override clubs</span>
              <strong>${escapeHtml(
                `${overrideBurdenSummary.currentOverrideClubCount} -> ${overrideBurdenSummary.projectedOverrideClubCount}`
              )}</strong>
              <span class="subtle">Clubs carrying at least one custom override before versus after this draft</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Override areas</span>
              <strong>${escapeHtml(
                `${overrideBurdenSummary.currentOverrideAreaCount} -> ${overrideBurdenSummary.projectedOverrideAreaCount}`
              )}</strong>
              <span class="subtle">Total overridden policy areas across clubs before versus after this draft</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Override burden</span>
              <strong>${escapeHtml(
                overrideBurdenSummary.projectedOverrideAreaCount <
                  overrideBurdenSummary.currentOverrideAreaCount
                  ? "Reduced"
                  : overrideBurdenSummary.projectedOverrideAreaCount >
                      overrideBurdenSummary.currentOverrideAreaCount
                    ? "Increased"
                    : "Unchanged"
              )}</strong>
              <span class="subtle">Use this to confirm whether the draft shrinks or expands exception sprawl.</span>
            </div>
          </div>`
        : ""
    }
    <div class="summary-stack" style="margin-top:16px;">
      <div class="summary-item" style="background: rgba(255,255,255,0.68);">
        <strong>Changed area rollout summary</strong>
        <p class="subtle" style="margin-top:6px;">Review each changed organization policy area to see where the draft will flow through and where club-specific overrides currently block it.</p>
      </div>
      ${areaRows}
    </div>
    ${burdenDeltaRows ? `<div class="summary-stack" style="margin-top:16px;">${burdenDeltaRows}</div>` : ""}
    ${renderExceptionCleanupSummary({
      title: "Exception cleanup priority",
      subtitle:
        "These clubs still override at least one organization area changed by this draft. Start here after you save if you want the rollout to land more uniformly.",
      items: cleanupItems,
      selectedClubSlug,
      organizationSlug: organizationDirectory?.organization?.slug || "",
      previewScopeType: "organization",
      previewDraftPolicy: JSON.stringify(previewOrganizationPolicy || {}),
      simulationInput,
      includeBulkCleanupControls: true,
      stagedCleanupAreaKey: previewCleanupAreaKey,
      stagedCleanupClubSlugs: previewCleanupClubSlugs
    })}
    <div class="summary-stack" style="margin-top:16px;">
      ${clubRows}
    </div>
  </section>`;
}

function buildLiveOrganizationAreaRolloutSummary({
  organizationDirectory = null,
  changedAreas = []
}) {
  const clubs = organizationDirectory?.clubs || [];

  return changedAreas.map((area) => {
    const inheritingClubs = [];
    const insulatedClubs = [];

    clubs.forEach((club) => {
      const overriddenFields = Array.isArray(club.overrideSummary?.overriddenFields)
        ? club.overrideSummary.overriddenFields
        : [];

      if (overriddenFields.includes(area.label)) {
        insulatedClubs.push(club);
      } else {
        inheritingClubs.push(club);
      }
    });

    return {
      ...area,
      inheritingClubs,
      insulatedClubs
    };
  });
}

function renderCurrentOrganizationRolloutState({
  organizationDirectory = null,
  changedAreas = [],
  selectedClubSlug = "",
  simulationInput = null,
  previewScopeType = null,
  previewDraftPolicy = null,
  title = "Current rollout state",
  subtitle = "This is the live organization rollout state for the areas changed by the latest save."
}) {
  const items = buildLiveOrganizationAreaRolloutSummary({
    organizationDirectory,
    changedAreas
  });

  if (!items.length) {
    return "";
  }

  return `<div class="summary-stack" style="margin-top:16px;">
      <div class="summary-item" style="background: rgba(255,255,255,0.68);">
        <strong>${escapeHtml(title)}</strong>
        <p class="subtle" style="margin-top:6px;">${escapeHtml(subtitle)}</p>
      </div>
      ${items
        .map(
          (area) => `<div class="summary-item">
            <div class="badge-row" style="justify-content:space-between; margin-bottom:6px;">
              <strong>${escapeHtml(area.label)}</strong>
              ${renderStatusBadge(
                `${area.inheritingClubs.length} inheriting / ${area.insulatedClubs.length} insulated`,
                area.insulatedClubs.length ? "review" : "good"
              )}
            </div>
            <p class="subtle">${
              area.inheritingClubs.length
                ? escapeHtml(
                    `Currently inheriting: ${area.inheritingClubs
                      .map((club) => club.name)
                      .join(", ")}`
                  )
                : "No clubs are currently inheriting this area."
            }</p>
            <p class="subtle" style="margin-top:6px;">${
              area.insulatedClubs.length
                ? escapeHtml(
                    `Still insulated by overrides: ${area.insulatedClubs
                      .map((club) => club.name)
                      .join(", ")}`
                  )
                : "No clubs are still insulating themselves from this area."
            }</p>
            <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
              <a class="quick-link" href="${buildWorkflowSettingsLink({
                clubSlug: selectedClubSlug,
                clubView: "overrides",
                clubArea: area.key,
                simulationInput,
                previewScopeType,
                previewDraftPolicy
              })}">Review ${escapeHtml(area.label.toLowerCase())} exceptions</a>
              <a class="quick-link" href="${buildWorkflowSettingsLink({
                clubSlug: selectedClubSlug,
                clubView: "inheriting",
                clubArea: area.key,
                simulationInput,
                previewScopeType,
                previewDraftPolicy
              })}">Review ${escapeHtml(area.label.toLowerCase())} inheriting clubs</a>
            </div>
          </div>`
        )
        .join("")}
    </div>`;
}

function renderWorkflowSaveSummary(
  saveSummary,
  organizationDirectory = null,
  selectedClubName = "",
  simulationInput = null,
  {
    organizationHistory = null,
    clubHistory = null
  } = {}
) {
  if (!saveSummary) {
    return "";
  }

  if (saveSummary.scopeType === "organization_cleanup") {
    const cleanupArea = trackedPolicyAreaFields.find(
      (area) => area.key === saveSummary.cleanupAreaKey
    );
    const cleanupAreaLabel = cleanupArea?.label || formatPolicyFieldLabel(saveSummary.cleanupAreaKey);
    const cleanedClubs = saveSummary.cleanedClubs || [];

    return `<section class="panel" style="border-color: rgba(23, 103, 68, 0.26); background: linear-gradient(180deg, rgba(235, 248, 240, 0.96), rgba(255, 255, 255, 0.96));">
      <div class="section-header">
        <div>
          <div class="eyebrow">Bulk exception cleanup saved</div>
          <h2>${escapeHtml(cleanupAreaLabel)} returned to the organization default</h2>
          <p class="subtle" style="margin-top:8px;">This cleanup removed the selected club-level ${escapeHtml(
            cleanupAreaLabel.toLowerCase()
          )} exception${cleanedClubs.length === 1 ? "" : "s"}.</p>
        </div>
        <span class="badge badge-good">Saved</span>
      </div>
      <div class="topline" style="margin-top:16px;">
        <div class="metric-card">
          <span class="metric-label">Clubs cleaned</span>
          <strong>${escapeHtml(String(cleanedClubs.length))}</strong>
          <span class="subtle">Selected clubs now inheriting this organization area</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Override clubs</span>
          <strong>${escapeHtml(
            `${saveSummary.currentOverrideClubCount} -> ${saveSummary.projectedOverrideClubCount}`
          )}</strong>
          <span class="subtle">Clubs carrying at least one custom override before versus after cleanup</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Override areas</span>
          <strong>${escapeHtml(
            `${saveSummary.currentOverrideAreaCount} -> ${saveSummary.projectedOverrideAreaCount}`
          )}</strong>
          <span class="subtle">Total overridden policy areas across the organization before versus after cleanup</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Area cleaned</span>
          <strong>${escapeHtml(cleanupAreaLabel)}</strong>
          <span class="subtle">Use the follow-up links to review what still differs</span>
        </div>
      </div>
      ${
        cleanedClubs.length
          ? `<div class="summary-stack" style="margin-top:16px;">
              <div class="summary-item" style="background: rgba(255,255,255,0.68);">
                <strong>Clubs updated</strong>
                <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
                  ${cleanedClubs
                    .map(
                      (club) => `<span class="badge badge-good">${escapeHtml(
                        club.name || club.slug || ""
                      )}</span>`
                    )
                    .join("")}
                </div>
              </div>
            </div>`
          : ""
      }
      <div class="badge-row" style="margin-top:16px;">
        <a class="quick-link" href="${buildWorkflowSettingsLink({
          clubSlug: saveSummary.clubSlug || "",
          clubView: "overrides",
          clubArea: saveSummary.cleanupAreaKey,
          simulationInput
        })}">Review remaining ${escapeHtml(cleanupAreaLabel.toLowerCase())} exceptions</a>
        <a class="quick-link" href="${buildWorkflowSettingsLink({
          clubSlug: saveSummary.clubSlug || "",
          clubView: "inheriting",
          clubArea: saveSummary.cleanupAreaKey,
          simulationInput
        })}">Review inheriting ${escapeHtml(cleanupAreaLabel.toLowerCase())} clubs</a>
      </div>
    </section>`;
  }

  if (saveSummary.scopeType === "club") {
    const changedAreaCount = Number(saveSummary.changedAreaCount || 0);
    const currentOverrideAreaCount = Number(saveSummary.currentOverrideAreaCount || 0);
    const projectedOverrideAreaCount = Number(saveSummary.projectedOverrideAreaCount || 0);
    const changedAreas = (saveSummary.changedAreaKeys || [])
      .map((key) => trackedPolicyAreaFields.find((area) => area.key === key) || null)
      .filter(Boolean);
    const addedAreas = (saveSummary.addedAreaKeys || [])
      .map((key) => trackedPolicyAreaFields.find((area) => area.key === key) || null)
      .filter(Boolean);
    const removedAreas = (saveSummary.removedAreaKeys || [])
      .map((key) => trackedPolicyAreaFields.find((area) => area.key === key) || null)
      .filter(Boolean);
    const retainedAreas = (saveSummary.retainedAreaKeys || [])
      .map((key) => trackedPolicyAreaFields.find((area) => area.key === key) || null)
      .filter(Boolean);
    const latestClubChangeDetails = extractSaveChangeDetails(
      clubHistory,
      saveSummary.changedAreaKeys || []
    );
    const sections = [
      {
        title: "New exceptions",
        items: addedAreas,
        empty: "This save did not add any new club-specific exceptions.",
        linkVariant: "overrides",
        actionLabel: "Review"
      },
      {
        title: "Exceptions removed",
        items: removedAreas,
        empty: "This save did not remove any existing club-specific exceptions.",
        linkVariant: "inheriting",
        actionLabel: "Review"
      },
      {
        title: "Exceptions retained",
        items: retainedAreas,
        empty: "This save did not carry forward any existing club-specific exceptions.",
        linkVariant: "overrides",
        actionLabel: "Review"
      }
    ];

    return `<section class="panel" style="border-color: rgba(23, 103, 68, 0.26); background: linear-gradient(180deg, rgba(235, 248, 240, 0.96), rgba(255, 255, 255, 0.96));">
      <div class="section-header">
        <div>
          <div class="eyebrow">Saved club policy</div>
          <h2>Club exceptions saved with change context</h2>
          <p class="subtle" style="margin-top:8px;">This save changed ${escapeHtml(String(changedAreaCount))} club policy area${changedAreaCount === 1 ? "" : "s"} for ${escapeHtml(selectedClubName || saveSummary.clubName || saveSummary.clubSlug || "this club")}.</p>
        </div>
        <span class="badge badge-good">Saved</span>
      </div>
      <div class="topline" style="margin-top:16px;">
        <div class="metric-card">
          <span class="metric-label">Override areas</span>
          <strong>${escapeHtml(
            `${currentOverrideAreaCount} -> ${projectedOverrideAreaCount}`
          )}</strong>
          <span class="subtle">Top-level club exceptions before versus after this save</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">New exceptions</span>
          <strong>${escapeHtml(String(addedAreas.length))}</strong>
          <span class="subtle">Areas this club now overrides locally</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Exceptions removed</span>
          <strong>${escapeHtml(String(removedAreas.length))}</strong>
          <span class="subtle">Areas returned to the organization default</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Override burden</span>
          <strong>${escapeHtml(
            projectedOverrideAreaCount < currentOverrideAreaCount
              ? "Reduced"
              : projectedOverrideAreaCount > currentOverrideAreaCount
                ? "Increased"
                : "Unchanged"
          )}</strong>
          <span class="subtle">Use the summary below to keep this club-specific layer intentional.</span>
        </div>
      </div>
      ${renderSaveChangeDetailsCard(
        latestClubChangeDetails,
        "These before-and-after values come from the latest recorded club policy update."
      )}
      <div class="summary-stack" style="margin-top:16px;">
        <div class="summary-item" style="background: rgba(255,255,255,0.68);">
          <strong>Changed policy areas</strong>
          <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
            ${
              changedAreas.length
                ? changedAreas
                    .map(
                      (area) => `<span class="badge badge-info">${escapeHtml(
                        area.label
                      )}</span>`
                    )
                    .join("")
                : `<span class="subtle">No changed club policy areas were captured for this save.</span>`
            }
          </div>
          <p class="subtle" style="margin-top:8px;">This list shows what changed in the saved club layer, even when the club still lines up with the organization default afterward.</p>
        </div>
        ${sections
          .map(
            (section) => `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
              <strong>${escapeHtml(section.title)}</strong>
              <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
                ${
                  section.items.length
                    ? section.items
                        .map(
                          (area) => `<span class="badge badge-info">${escapeHtml(
                            area.label
                          )}</span>`
                        )
                        .join("")
                    : `<span class="subtle">${escapeHtml(section.empty)}</span>`
                }
              </div>
              ${
                section.items.length
                  ? `<div class="badge-row" style="margin-top:10px;">
                      ${section.items
                        .map(
                          (area) => `<a class="quick-link" href="${buildWorkflowSettingsLink({
                            clubSlug: saveSummary.clubSlug || "",
                            clubView: section.linkVariant,
                            clubArea: area.key,
                            simulationInput
                          })}">${escapeHtml(section.actionLabel)} ${escapeHtml(
                            area.label.toLowerCase()
                          )} ${section.linkVariant === "inheriting" ? "inheritance" : "exceptions"}</a>`
                        )
                        .join("")}
                    </div>`
                  : ""
              }
            </div>`
          )
          .join("")}
        <div class="summary-item" style="background: rgba(255,255,255,0.68);">
          <strong>Next step</strong>
          <p class="subtle" style="margin-top:6px;">Run the simulator below against this saved policy to confirm the live routing, approval, publishing, and notification path for this club.</p>
        </div>
      </div>
    </section>`;
  }

  if (saveSummary.scopeType !== "organization") {
    return "";
  }

  const changedAreaCount = Number(saveSummary.changedAreaCount || 0);
  const affectedClubCount = Number(saveSummary.affectedClubCount || 0);
  const insulatedClubCount = Number(saveSummary.insulatedClubCount || 0);
  const currentOverrideClubCount = Number(saveSummary.currentOverrideClubCount || 0);
  const projectedOverrideClubCount = Number(saveSummary.projectedOverrideClubCount || 0);
  const currentOverrideAreaCount = Number(saveSummary.currentOverrideAreaCount || 0);
  const projectedOverrideAreaCount = Number(saveSummary.projectedOverrideAreaCount || 0);
  const changedAreas = (saveSummary.changedAreaKeys || [])
    .map((key) => trackedPolicyAreaFields.find((area) => area.key === key) || null)
    .filter(Boolean);
  const cleanupItems = buildRemainingExceptionCleanupItems({
    clubs: organizationDirectory?.clubs || [],
    changedAreas
  });
  const changedAreaLinks = changedAreas.length
    ? `<div class="summary-stack" style="margin-top:16px;">
        <div class="summary-item" style="background: rgba(255,255,255,0.68);">
          <strong>Review changed areas</strong>
          <p class="subtle" style="margin-top:6px;">Use these links to review remaining overrides and fully inherited clubs for the areas you just changed.</p>
        </div>
        ${changedAreas
          .map(
            (area) => `<div class="summary-item">
              <strong>${escapeHtml(area.label)}</strong>
              <p style="margin-top:8px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
                clubSlug: saveSummary.clubSlug || "",
                clubView: "overrides",
                clubArea: area.key,
                simulationInput
              })}">Review ${escapeHtml(area.label.toLowerCase())} exceptions</a></p>
              <p style="margin-top:6px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
                clubSlug: saveSummary.clubSlug || "",
                clubView: "inheriting",
                clubArea: area.key,
                simulationInput
              })}">Review ${escapeHtml(area.label.toLowerCase())} inheriting clubs</a></p>
            </div>`
          )
          .join("")}
      </div>`
    : "";
  const reducingClubs = saveSummary.reducingClubs || [];
  const gainingClubs = saveSummary.gainingClubs || [];
  const guardrailWarnings = saveSummary.guardrailWarnings || [];
  const cleanupArea = trackedPolicyAreaFields.find(
    (area) => area.key === saveSummary.cleanupAreaKey
  );
  const cleanedClubs = saveSummary.cleanedClubs || [];
  const latestOrganizationChangeDetails = extractSaveChangeDetails(
    organizationHistory,
    saveSummary.changedAreaKeys || []
  );
  const burdenDeltaRows = [
    {
      title: "Clubs that got simpler",
      items: reducingClubs,
      empty: "No clubs reduced override burden from this save."
    },
    {
      title: "Clubs that got more complex",
      items: gainingClubs,
      empty: "No clubs gained override burden from this save."
    }
  ]
    .map(
      (group) => `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
        <strong>${escapeHtml(group.title)}</strong>
        <div class="summary-stack" style="margin-top:12px;">
          ${
            group.items.length
              ? group.items
                  .map(
                    (item) => `<div class="summary-item">
                      <strong>${escapeHtml(item.name)}</strong>
                      <p class="subtle" style="margin-top:6px;">${escapeHtml(
                        `${item.liveOverrideCount} -> ${item.previewOverrideCount} override areas`
                      )}</p>
                      ${
                        item.slug
                          ? `<p style="margin-top:8px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
                              clubSlug: item.slug,
                              simulationInput
                            })}">Open ${escapeHtml(item.name)} policy stack</a></p>`
                          : ""
                      }
                    </div>`
                  )
                  .join("")
              : `<p class="subtle">${escapeHtml(group.empty)}</p>`
          }
        </div>
      </div>`
    )
    .join("");

  return `<section class="panel" style="border-color: rgba(23, 103, 68, 0.26); background: linear-gradient(180deg, rgba(235, 248, 240, 0.96), rgba(255, 255, 255, 0.96));">
    <div class="section-header">
      <div>
        <div class="eyebrow">Saved organization policy</div>
        <h2>Organization defaults saved with rollout context</h2>
        <p class="subtle" style="margin-top:8px;">This save changed ${escapeHtml(String(changedAreaCount))} organization policy area${changedAreaCount === 1 ? "" : "s"}.</p>
      </div>
      <span class="badge badge-good">Saved</span>
    </div>
    <div class="topline" style="margin-top:16px;">
      <div class="metric-card">
        <span class="metric-label">Clubs now inheriting</span>
        <strong>${escapeHtml(String(affectedClubCount))}</strong>
        <span class="subtle">Clubs that will follow these saved organization changes</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Clubs still insulating</span>
        <strong>${escapeHtml(String(insulatedClubCount))}</strong>
        <span class="subtle">Clubs still shielding themselves with overrides in the changed areas</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Next step</span>
        <strong>${escapeHtml(
          insulatedClubCount > 0 ? "Review exceptions" : "Rollout aligned"
        )}</strong>
        <span class="subtle">${
          insulatedClubCount > 0
            ? "Use the rollout summary below to decide whether those club overrides should remain."
            : "No clubs are currently shielding themselves from these saved organization changes."
        }</span>
      </div>
    </div>
    <div class="topline" style="margin-top:12px;">
      <div class="metric-card">
        <span class="metric-label">Override clubs</span>
        <strong>${escapeHtml(
          `${currentOverrideClubCount} -> ${projectedOverrideClubCount}`
        )}</strong>
        <span class="subtle">Clubs carrying at least one custom override before versus after the save</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Override areas</span>
        <strong>${escapeHtml(
          `${currentOverrideAreaCount} -> ${projectedOverrideAreaCount}`
        )}</strong>
        <span class="subtle">Total overridden policy areas across the organization before versus after the save</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Override burden</span>
        <strong>${escapeHtml(
          projectedOverrideAreaCount < currentOverrideAreaCount
            ? "Reduced"
            : projectedOverrideAreaCount > currentOverrideAreaCount
              ? "Increased"
              : "Unchanged"
        )}</strong>
        <span class="subtle">Measured from the preview comparison captured at save time</span>
      </div>
    </div>
    ${renderPolicyGuardrailsCard(guardrailWarnings, {
      scopeType: "organization",
      selectedClubSlug: saveSummary.clubSlug || "",
      simulationInput
    })}
    ${renderSaveChangeDetailsCard(
      latestOrganizationChangeDetails,
      "These before-and-after values come from the latest recorded organization policy update."
    )}
    ${
      cleanupArea && cleanedClubs.length
        ? `<div class="summary-stack" style="margin-top:16px;">
            <div class="summary-item" style="background: rgba(255,255,255,0.68);">
              <strong>Cleanup staged into this save</strong>
              <p class="subtle" style="margin-top:6px;">${escapeHtml(
                `${cleanupArea.label} exceptions were cleared for ${cleanedClubs.length} club${
                  cleanedClubs.length === 1 ? "" : "s"
                } as part of this organization save.`
              )}</p>
              <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
                ${cleanedClubs
                  .map(
                    (club) => `<span class="badge badge-good">${escapeHtml(
                      club.name || club.slug || ""
                    )}</span>`
                  )
                  .join("")}
              </div>
            </div>
          </div>`
        : ""
    }
    ${renderCurrentOrganizationRolloutState({
      organizationDirectory,
      changedAreas,
      selectedClubSlug: saveSummary.clubSlug || "",
      simulationInput,
      title: "Current rollout state by changed area",
      subtitle:
        "Use this live view to confirm which clubs are now inheriting each saved organization area and which clubs are still insulating themselves with overrides."
    })}
    <div class="summary-stack" style="margin-top:16px;">${burdenDeltaRows}</div>
    ${renderExceptionCleanupSummary({
      title: "Remaining exception cleanup",
      subtitle:
        "These clubs still override one or more organization areas you just changed. Review them next if you want the saved default to propagate more consistently.",
      items: cleanupItems,
      selectedClubSlug: saveSummary.clubSlug || "",
      organizationSlug: organizationDirectory?.organization?.slug || "",
      simulationInput,
      includePreviewInheritanceLinks: true,
      includeBulkCleanupControls: true
    })}
    ${changedAreaLinks}
  </section>`;
}

function renderClubOverrideSummary({ clubPolicy = {}, organizationPolicy = {} }) {
  const summary = buildClubOverrideSummary({ clubPolicy, organizationPolicy });
  const overrideList = summary.overridden.length
    ? summary.overridden
        .map(
          (field) => `<span class="badge badge-good">${escapeHtml(field.label)}</span>`
        )
        .join("")
    : `<span class="subtle">This club is currently fully aligned to the organization default.</span>`;

  return `<section class="panel">
    <div class="section-header">
      <div>
        <div class="eyebrow">Club override summary</div>
        <h2>How much this club diverges from the organization</h2>
        <p class="subtle" style="margin-top:8px;">Use this as a quick rollout check before keeping or removing club-specific policy.</p>
      </div>
    </div>
    <div class="topline">
      <div class="metric-card">
        <span class="metric-label">Club overrides</span>
        <strong>${escapeHtml(String(summary.overridden.length))}</strong>
        <span class="subtle">Top-level policy areas customized here</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Inherited areas</span>
        <strong>${escapeHtml(String(summary.inheritedCount))}</strong>
        <span class="subtle">Top-level policy areas following the organization</span>
      </div>
    </div>
    <div class="badge-row" style="margin-top:14px; align-items:flex-start;">
      ${overrideList}
    </div>
  </section>`;
}

function parseGuardrailWarningList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        title: String(item.title || "").trim(),
        message: String(item.message || "").trim(),
        areaKey: String(item.areaKey || "").trim() || null
      }))
      .filter((item) => item.title && item.message);
  } catch {
    return [];
  }
}

function extractSaveChangeDetails(history, changedAreaKeys = []) {
  const items = Array.isArray(history?.items) ? history.items : [];
  const latestItem = items[0];
  const details = Array.isArray(latestItem?.metadata?.changedFieldDetails)
    ? latestItem.metadata.changedFieldDetails
    : [];
  const changedKeySet = new Set(
    Array.isArray(changedAreaKeys) ? changedAreaKeys.filter(Boolean) : []
  );

  return details.filter((detail) => {
    const field = String(detail?.field || "").trim();
    return field && (!changedKeySet.size || changedKeySet.has(field));
  });
}

function renderSaveChangeDetailsCard(changeDetails, subtitle) {
  if (!changeDetails.length) {
    return "";
  }

  return `<div class="summary-stack" style="margin-top:16px;">
    <div class="summary-item" style="background: rgba(255,255,255,0.68);">
      <strong>Latest recorded field changes</strong>
      <p class="subtle" style="margin-top:6px;">${escapeHtml(subtitle)}</p>
    </div>
    ${changeDetails
      .map(
        (detail) => `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
          <strong>${escapeHtml(formatPolicyFieldLabel(detail.field))}</strong>
          <p class="subtle" style="margin-top:6px;">Before: ${escapeHtml(
            summarizePolicyHistoryValue(detail.previousValue)
          )}</p>
          <p class="subtle" style="margin-top:6px;">After: ${escapeHtml(
            summarizePolicyHistoryValue(detail.nextValue)
          )}</p>
        </div>`
      )
      .join("")}
  </div>`;
}

function buildClubDraftOverrideImpact({
  organizationPolicy = {},
  liveClubPolicy = {},
  previewClubPolicy = {}
}) {
  const liveSummary = buildClubOverrideSummary({
    clubPolicy: liveClubPolicy,
    organizationPolicy
  });
  const previewSummary = buildClubOverrideSummary({
    clubPolicy: previewClubPolicy,
    organizationPolicy
  });
  const liveMap = new Map(liveSummary.overridden.map((field) => [field.key, field]));
  const previewMap = new Map(
    previewSummary.overridden.map((field) => [field.key, field])
  );

  return {
    liveOverrideCount: liveSummary.overridden.length,
    previewOverrideCount: previewSummary.overridden.length,
    added: previewSummary.overridden.filter((field) => !liveMap.has(field.key)),
    removed: liveSummary.overridden.filter((field) => !previewMap.has(field.key)),
    retained: previewSummary.overridden.filter((field) => liveMap.has(field.key))
  };
}

function renderClubDraftOverrideImpactSummary({
  previewScopeType,
  organizationPolicy,
  liveClubPolicy,
  previewClubPolicy,
  selectedClubSlug = "",
  simulationInput = null
}) {
  if (previewScopeType !== "club") {
    return "";
  }

  const impact = buildClubDraftOverrideImpact({
    organizationPolicy,
    liveClubPolicy,
    previewClubPolicy
  });
  const changedAreas = listChangedPolicyAreas({
    livePolicy: liveClubPolicy,
    previewPolicy: previewClubPolicy
  });
  const sections = [
    {
      title: "New club exceptions",
      items: impact.added,
      empty: "This draft does not add any new club-specific exceptions.",
      linkVariant: "overrides"
    },
    {
      title: "Exceptions removed",
      items: impact.removed,
      empty: "This draft does not remove any existing club-specific exceptions.",
      linkVariant: "inheriting"
    },
    {
      title: "Exceptions retained",
      items: impact.retained,
      empty: "No existing exceptions are being carried forward in this draft.",
      linkVariant: "overrides"
    }
  ];

  return `<section class="panel">
    <div class="section-header">
      <div>
        <div class="eyebrow">Club exception impact</div>
        <h2>What this club draft changes about local exceptions</h2>
        <p class="subtle" style="margin-top:8px;">Compare the current club override layer against the unsaved draft before you introduce new divergence from the organization default.</p>
      </div>
    </div>
    <div class="topline">
      <div class="metric-card">
        <span class="metric-label">Override areas</span>
        <strong>${escapeHtml(
          `${impact.liveOverrideCount} -> ${impact.previewOverrideCount}`
        )}</strong>
        <span class="subtle">Top-level club exceptions before versus after this draft</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">New exceptions</span>
        <strong>${escapeHtml(String(impact.added.length))}</strong>
        <span class="subtle">Areas this draft starts overriding locally</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Exceptions removed</span>
        <strong>${escapeHtml(String(impact.removed.length))}</strong>
        <span class="subtle">Areas this draft returns to the organization default</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Override burden</span>
        <strong>${escapeHtml(
          impact.previewOverrideCount < impact.liveOverrideCount
            ? "Reduced"
            : impact.previewOverrideCount > impact.liveOverrideCount
              ? "Increased"
              : "Unchanged"
        )}</strong>
        <span class="subtle">Use this to keep club-specific policy intentional.</span>
      </div>
    </div>
    <div class="summary-stack" style="margin-top:16px;">
      <div class="summary-item" style="background: rgba(255,255,255,0.68);">
        <strong>Changed policy areas</strong>
        <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
          ${
            changedAreas.length
              ? changedAreas
                  .map(
                    (area) => `<span class="badge badge-info">${escapeHtml(
                      area.label
                    )}</span>`
                  )
                  .join("")
              : `<span class="subtle">No changed club policy areas are in this draft.</span>`
          }
        </div>
        <p class="subtle" style="margin-top:8px;">This shows what changes in the club layer even when the draft still aligns to the organization default afterward.</p>
      </div>
      ${sections
        .map(
          (section) => `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
            <strong>${escapeHtml(section.title)}</strong>
            <div class="badge-row" style="margin-top:10px; align-items:flex-start;">
              ${
                section.items.length
                  ? section.items
                      .map(
                        (field) => `<span class="badge badge-info">${escapeHtml(
                          field.label
                        )}</span>`
                      )
                      .join("")
                  : `<span class="subtle">${escapeHtml(section.empty)}</span>`
              }
            </div>
            ${
              section.items.length
                ? `<div class="badge-row" style="margin-top:10px;">
                    ${section.items
                      .map(
                        (field) => `<a class="quick-link" href="${buildWorkflowSettingsLink({
                          clubSlug: selectedClubSlug,
                          clubView: section.linkVariant,
                          clubArea: field.key,
                          previewScopeType: "club",
                          previewDraftPolicy: JSON.stringify(previewClubPolicy || {}),
                          simulationInput
                        })}">Review ${escapeHtml(field.label.toLowerCase())} ${
                          section.linkVariant === "inheriting" ? "inheritance" : "exceptions"
                        }</a>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>`
        )
        .join("")}
    </div>
  </section>`;
}

function renderOrganizationDirectory(
  directory,
  clubView = "all",
  clubArea = "all",
  selectedClubSlug = "",
  simulationInput = null,
  previewScopeType = null,
  previewDraftPolicy = null
) {
  if (!directory) {
    return "";
  }

  const clubs = Array.isArray(directory.clubs) ? [...directory.clubs] : [];
  const totalClubs = clubs.length;
  const normalizedClubView =
    clubView === "overrides" || clubView === "inheriting" ? clubView : "all";
  const areaOption = trackedPolicyAreaFields.find(({ key }) => key === clubArea) || null;
  const normalizedClubArea = areaOption?.key || "all";
  const focusedAreaLabel = areaOption?.label || "All policy areas";
  const clubOverridesFocusedArea = (club) =>
    Array.isArray(club.overrideSummary?.overriddenFields) &&
    club.overrideSummary.overriddenFields.includes(focusedAreaLabel);
  const clubsWithOverrides = clubs
    .filter((club) => Number(club.overrideSummary?.overrideCount || 0) > 0)
    .filter((club) => {
      if (normalizedClubArea === "all") {
        return true;
      }

      return clubOverridesFocusedArea(club);
    })
    .sort(
      (left, right) =>
        Number(right.overrideSummary?.overrideCount || 0) -
          Number(left.overrideSummary?.overrideCount || 0) ||
        String(left.name || "").localeCompare(String(right.name || ""))
    );
  const inheritingClubs = clubs
    .filter((club) =>
      normalizedClubArea === "all"
        ? Number(club.overrideSummary?.overrideCount || 0) === 0
        : !clubOverridesFocusedArea(club)
    )
    .sort((left, right) =>
      String(left.name || "").localeCompare(String(right.name || ""))
    );
  const areaSummary = buildOrganizationOverrideAreaSummary(clubsWithOverrides);
  const governanceSummary = buildOrganizationGovernanceSummary(clubs);

  function buildDirectoryLinkParams(nextClubArea, nextClubView = "overrides") {
    return buildWorkflowSettingsLink({
      clubSlug: selectedClubSlug,
      clubView: nextClubView,
      clubArea: nextClubArea !== "all" ? nextClubArea : null,
      simulationInput,
      previewScopeType,
      previewDraftPolicy
    }).replace("/workflow-settings?", "");
  }

  function renderClubDirectoryItem(club) {
    return `<div class="summary-item">
      <strong>${escapeHtml(club.name)}</strong>
      <p class="subtle">${escapeHtml(club.slug)}</p>
      <p style="margin-top:6px;">${escapeHtml(
        club.overrideSummary?.overrideCount
          ? `${club.overrideSummary.overrideCount} override areas`
          : "Fully inheriting organization defaults"
      )}</p>
      ${
        Array.isArray(club.overrideSummary?.overriddenFields) &&
        club.overrideSummary.overriddenFields.length
          ? `<div class="badge-row" style="margin-top:8px;">
              ${club.overrideSummary.overriddenFields
                .map(
                  (field) => `<span class="badge badge-good">${escapeHtml(field)}</span>`
                )
                .join("")}
            </div>`
          : ""
      }
      <p style="margin-top:8px;"><a class="quick-link" href="${buildWorkflowSettingsLink({
        clubSlug: club.slug || "",
        simulationInput,
        previewScopeType,
        previewDraftPolicy
      })}">Open ${escapeHtml(club.name)} policy stack</a></p>
    </div>`;
  }

  const clubList = clubs.length
    ? `
      <div class="topline" style="margin-bottom:14px;">
        <div class="metric-card">
          <span class="metric-label">Clubs with overrides</span>
          <strong>${escapeHtml(String(clubsWithOverrides.length))}</strong>
          <span class="subtle">Clubs still carrying custom policy</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">${
            normalizedClubView === "inheriting" && normalizedClubArea !== "all"
              ? "Inheriting this area"
              : "Fully inheriting"
          }</span>
          <strong>${escapeHtml(String(inheritingClubs.length))}</strong>
          <span class="subtle">${
            normalizedClubView === "inheriting" && normalizedClubArea !== "all"
              ? escapeHtml(
                  `Clubs still following the organization default for ${focusedAreaLabel.toLowerCase()}.`
                )
              : "Clubs aligned to the organization default"
          }</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Current view</span>
          <strong>${escapeHtml(
            normalizedClubView === "overrides"
              ? "Overrides only"
              : normalizedClubView === "inheriting"
                ? "Fully inheriting"
                : "All clubs"
          )}</strong>
          <span class="subtle">Use the page filter to narrow exception cleanup.</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Policy area focus</span>
          <strong>${escapeHtml(
            normalizedClubArea === "all" ? "All policy areas" : focusedAreaLabel
          )}</strong>
          <span class="subtle">${
            normalizedClubView === "inheriting" && normalizedClubArea !== "all"
              ? escapeHtml(
                  `Showing clubs still inheriting ${focusedAreaLabel.toLowerCase()} from the organization default.`
                )
              : normalizedClubView === "inheriting"
                ? "Review clubs that are still fully aligned to the organization default."
              : escapeHtml(
                  normalizedClubArea === "all"
                    ? "Review overrides across every tracked workflow area."
                    : `Showing clubs overriding ${focusedAreaLabel.toLowerCase()}.`
                )
          }</span>
        </div>
      </div>
      ${
        governanceSummary.length
          ? `<div class="summary-item" style="background: rgba(255,255,255,0.68); margin-bottom:12px;">
              <strong>Governance watchlist</strong>
              <p class="subtle" style="margin-top:6px;">Use this to see which policy areas are still centralized at the organization level and which are becoming club-by-club exceptions.</p>
              <div class="summary-stack" style="margin-top:12px;">
                ${governanceSummary
                  .map(
                    (area) => `<div class="summary-item">
                      <div class="badge-row" style="justify-content:space-between; margin-bottom:6px;">
                        <strong>${escapeHtml(area.label)}</strong>
                        ${renderStatusBadge(area.posture, area.posture === "Centralized" ? "good" : area.posture === "Watchlist" ? "info" : "review")}
                      </div>
                      <p class="subtle" style="margin-top:6px;">${escapeHtml(
                        area.overrideClubCount === 0
                          ? "No clubs are overriding this area right now."
                          : area.overrideClubCount === 1
                            ? `1 of ${totalClubs} clubs is overriding this area.`
                            : `${area.overrideClubCount} of ${totalClubs} clubs are overriding this area.`
                      )}</p>
                      <p class="subtle" style="margin-top:6px;">${escapeHtml(
                        area.matchingClubs.length
                          ? area.matchingClubs.map((club) => club.name).join(", ")
                          : "Organization default is fully holding here."
                      )}</p>
                      <p style="margin-top:8px;"><a class="quick-link" href="/workflow-settings?${buildDirectoryLinkParams(
                        area.key,
                        area.overrideClubCount ? "overrides" : "inheriting"
                      )}">${
                        area.overrideClubCount
                          ? `Review ${escapeHtml(area.label.toLowerCase())} exceptions`
                          : `Review ${escapeHtml(area.label.toLowerCase())} alignment`
                      }</a></p>
                    </div>`
                  )
                  .join("")}
              </div>
            </div>`
          : ""
      }
      ${
        normalizedClubView !== "inheriting" && areaSummary.length
          ? `<div class="summary-item" style="background: rgba(255,255,255,0.68); margin-bottom:12px;">
              <strong>Policy area hotspots</strong>
              <p class="subtle" style="margin-top:6px;">Use these counts to find the workflow area creating the most club-level exceptions.</p>
              <div class="summary-stack" style="margin-top:12px;">
                ${areaSummary
                  .map(
                    (area) => `<div class="summary-item">
                      <strong>${escapeHtml(area.label)}</strong>
                      <p class="subtle" style="margin-top:6px;">${escapeHtml(
                        area.clubCount === 1
                          ? "1 club overriding this area"
                          : `${area.clubCount} clubs overriding this area`
                      )}</p>
                      <p class="subtle" style="margin-top:6px;">${escapeHtml(
                        area.clubNames.join(", ")
                      )}</p>
                      <p style="margin-top:8px;"><a class="quick-link" href="/workflow-settings?${buildDirectoryLinkParams(
                        area.key
                      )}">Review ${escapeHtml(area.label.toLowerCase())} exceptions</a></p>
                    </div>`
                  )
                  .join("")}
              </div>
            </div>`
          : ""
      }
      <div class="summary-stack" style="margin-top:12px;">
        ${
          normalizedClubView !== "inheriting"
            ? `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
                <strong>${
                  normalizedClubArea === "all"
                    ? "Clubs needing exception review"
                    : `Clubs overriding ${escapeHtml(focusedAreaLabel)}`
                }</strong>
                <p class="subtle" style="margin-top:6px;">${
                  normalizedClubArea === "all"
                    ? "Most customized clubs appear first so you can clean up the biggest outliers quickly."
                    : `Most customized clubs affecting ${escapeHtml(
                        focusedAreaLabel.toLowerCase()
                      )} appear first so you can clean up that exception pattern quickly.`
                }</p>
              </div>
              ${
                clubsWithOverrides.length
                  ? clubsWithOverrides.map(renderClubDirectoryItem).join("")
                  : `<p class="subtle">${
                      normalizedClubArea === "all"
                        ? "No clubs in this organization are carrying custom workflow policy right now."
                        : `No clubs in this organization are overriding ${escapeHtml(
                            focusedAreaLabel.toLowerCase()
                          )} right now.`
                    }</p>`
              }`
            : ""
        }
        ${
          normalizedClubView !== "overrides"
            ? `<div class="summary-item" style="background: rgba(255,255,255,0.68);">
                <strong>${
                  normalizedClubArea === "all"
                    ? "Clubs fully inheriting organization defaults"
                    : `Clubs inheriting ${escapeHtml(focusedAreaLabel)}`
                }</strong>
                <p class="subtle" style="margin-top:6px;">${
                  normalizedClubArea === "all"
                    ? "These clubs will follow organization-level rollout changes unless a new override is added."
                    : `These clubs still follow the organization default for ${escapeHtml(
                        focusedAreaLabel.toLowerCase()
                      )}, even if they override other workflow areas.`
                }</p>
              </div>
              ${
                inheritingClubs.length
                  ? inheritingClubs.map(renderClubDirectoryItem).join("")
                  : `<p class="subtle">${
                      normalizedClubArea === "all"
                        ? "Every club in this organization currently has at least one custom override."
                        : `No clubs in this organization are currently inheriting ${escapeHtml(
                            focusedAreaLabel.toLowerCase()
                          )}.`
                    }</p>`
              }`
            : ""
        }
      </div>
    `
    : `<p class="subtle">No clubs linked to this organization yet.</p>`;

  const adminList = directory.admins?.length
    ? directory.admins
        .map(
          (admin) => `<div class="summary-item">
            <strong>${escapeHtml(admin.fullName || admin.email)}</strong>
            <p class="subtle">${escapeHtml(admin.email)} • ${escapeHtml(formatLabel(admin.role))}</p>
          </div>`
        )
        .join("")
    : `<p class="subtle">No organization admins or ops recorded yet.</p>`;

  return `<section class="panel">
    <div class="section-header">
      <div>
        <div class="eyebrow">Organization directory</div>
        <h2>${escapeHtml(directory.organization?.name || "Organization")}</h2>
        <p class="subtle" style="margin-top:8px;">Use this as the authority view for which clubs and admins belong to the organization.</p>
      </div>
      <span class="badge badge-neutral">${escapeHtml(directory.organization?.slug || "n/a")}</span>
    </div>
    <div class="footer-panels" style="margin-top:0;">
      <div class="panel" style="background: rgba(255,255,255,0.72);">
        <h3>Clubs in this organization</h3>
        ${clubList}
      </div>
      <div class="panel" style="background: rgba(255,255,255,0.72);">
        <h3>Organization admins</h3>
        <div class="summary-stack" style="margin-top:12px;">${adminList}</div>
      </div>
    </div>
  </section>`;
}

async function renderWorkflowSettingsPage(
  clubSlug,
  simulationInput = {},
  previewDraft = null,
  clubView = "all",
  clubArea = "all",
  saveSummary = null,
  previewResetArea = null,
  previewCleanupArea = null,
  previewCleanupClubs = []
) {
  const readiness = await fetchJson("/app/readiness");
  const selectedClubSlug = clubSlug || readiness?.demo?.clubSlug || "demo-soccer-club";
  const clubPolicy = await fetchJson(`/workflow-policies/clubs/${encodeURIComponent(selectedClubSlug)}`);
  const organizationSlug = clubPolicy.organization?.slug || null;
  const organizationPolicy = organizationSlug
    ? await fetchJson(`/workflow-policies/organizations/${encodeURIComponent(organizationSlug)}`)
    : null;
  const organizationDirectory = organizationSlug
    ? await fetchJson(`/organizations/${encodeURIComponent(organizationSlug)}`)
    : null;
  const organizationHistory = organizationSlug
    ? await fetchJson(
        `/workflow-policies/organizations/${encodeURIComponent(organizationSlug)}/history`
      )
    : null;
  const clubHistory = await fetchJson(
    `/workflow-policies/clubs/${encodeURIComponent(selectedClubSlug)}/history`
  );
  const reviewerEmail = readiness?.demo?.reviewerEmail || "comms@demo-club.local";
  const validPreviewResetArea =
    trackedPolicyAreaFields.find((area) => area.key === previewResetArea)?.key || null;
  const validPreviewCleanupArea =
    trackedPolicyAreaFields.find((area) => area.key === previewCleanupArea)?.key || null;
  const previewScopeType =
    previewDraft?.scopeType === "club" || previewDraft?.scopeType === "organization"
      ? previewDraft.scopeType
      : validPreviewResetArea
        ? "club"
      : null;
  const previewPayload =
    previewDraft?.payload && typeof previewDraft.payload === "object" && !Array.isArray(previewDraft.payload)
      ? previewDraft.payload
      : validPreviewResetArea
        ? buildInheritedClubPolicyPreview(clubPolicy.clubPolicy || {}, validPreviewResetArea)
      : null;
  const previewDraftPolicyParam =
    previewScopeType && previewPayload ? JSON.stringify(previewPayload) : null;
  const previewOrganizationPolicy =
    previewScopeType === "organization" && previewPayload
      ? previewPayload
      : organizationPolicy?.organizationPolicy || {};
  const previewClubPolicy =
    previewScopeType === "club" && previewPayload
      ? previewPayload
      : clubPolicy.clubPolicy || {};
  const effectivePolicy = buildEffectivePolicyFromPolicies({
    organizationPolicy: previewOrganizationPolicy,
    clubPolicy: previewClubPolicy
  });
  const liveEffectivePolicy = buildEffectivePolicyFromPolicies({
    organizationPolicy: organizationPolicy?.organizationPolicy || {},
    clubPolicy: clubPolicy.clubPolicy || {}
  });
  const normalizedSimulationInput = normalizeSimulationInput(simulationInput);
  const previewOutcome =
    previewScopeType && effectivePolicy
      ? simulatePolicyOutcome(effectivePolicy, normalizedSimulationInput)
      : null;
  const livePreviewOutcome =
    previewScopeType && liveEffectivePolicy
      ? simulatePolicyOutcome(liveEffectivePolicy, normalizedSimulationInput)
      : null;
  const previewRiskWarningCount = previewScopeType
    ? buildOutcomeRiskWarnings({
        liveOutcome: livePreviewOutcome,
        previewOutcome
      }).length
    : 0;
  const clubDraftChangedAreas =
    previewScopeType === "club"
      ? listChangedPolicyAreas({
          livePolicy: clubPolicy.clubPolicy || {},
          previewPolicy: previewClubPolicy
        })
      : [];
  const clubDraftOverrideImpact =
    previewScopeType === "club"
      ? buildClubDraftOverrideImpact({
          organizationPolicy: previewOrganizationPolicy,
          liveClubPolicy: clubPolicy.clubPolicy || {},
          previewClubPolicy
        })
      : null;
  const organizationClubPolicyMap =
    organizationDirectory && (previewScopeType === "organization" || saveSummary?.scopeType === "organization")
      ? await fetchOrganizationClubPolicyMap({
          organizationDirectory,
          selectedClubSlug,
          selectedClubPolicy: clubPolicy
        })
      : null;
  const validPreviewCleanupClubSlugs =
    validPreviewCleanupArea && organizationDirectory
      ? previewCleanupClubs.filter((slug) =>
          (organizationDirectory.clubs || []).some((club) => club.slug === slug)
        )
      : [];
  const stagedOrganizationClubPolicyMap =
    previewScopeType === "organization" &&
    validPreviewCleanupArea &&
    validPreviewCleanupClubSlugs.length &&
    organizationClubPolicyMap
      ? Object.fromEntries(
          Object.entries(organizationClubPolicyMap).map(([slug, value]) => [
            slug,
            validPreviewCleanupClubSlugs.includes(slug)
              ? {
                  ...value,
                  clubPolicy: {
                    ...(value?.clubPolicy || {}),
                    [validPreviewCleanupArea]: null
                  }
                }
              : value
          ])
        )
      : organizationClubPolicyMap;
  const previewOrganizationDirectory =
    previewScopeType === "organization" &&
    organizationDirectory &&
    stagedOrganizationClubPolicyMap
      ? buildOrganizationDirectoryPreview({
          organizationDirectory,
          organizationPolicy: previewOrganizationPolicy,
          clubPolicyMap: stagedOrganizationClubPolicyMap
        })
      : organizationDirectory;
  const organizationDraftImpact =
    previewScopeType === "organization"
      ? buildOrganizationDraftImpact({
          organizationPolicy,
          previewOrganizationPolicy,
          organizationDirectory: previewOrganizationDirectory,
          clubPolicyMap: stagedOrganizationClubPolicyMap
        })
      : null;
  const overrideBurdenSummary =
    previewScopeType === "organization" && stagedOrganizationClubPolicyMap
      ? buildOrganizationDraftOverrideBurdenSummary({
          organizationDirectory: previewOrganizationDirectory,
          organizationPolicy,
          previewOrganizationPolicy,
          clubPolicyMap: stagedOrganizationClubPolicyMap
        })
      : null;
  const previewPolicyGuardrails =
    previewScopeType === "organization"
      ? buildPolicyGuardrailWarnings({
          scopeType: "organization",
          livePolicy: organizationPolicy?.organizationPolicy || {},
          previewPolicy: previewOrganizationPolicy,
          affectedClubCount: organizationDraftImpact?.affectedClubs.length || 0,
          overrideBurdenSummary
        })
      : previewScopeType === "club"
        ? buildPolicyGuardrailWarnings({
            scopeType: "club",
            livePolicy: liveEffectivePolicy,
            previewPolicy: effectivePolicy
          })
        : [];
  const previewWarningCount = previewRiskWarningCount + previewPolicyGuardrails.length;

  return layout(`
    <section class="hero">
      <div>
        <div class="eyebrow">Workflow settings</div>
        <h1>Set routing rules by club or by organization.</h1>
        <p class="subtle" style="margin-top:10px; max-width:780px;">This is the multi-organization control layer for review routing, auto-approval, publishing rules, and notification rules. Club settings can override organization defaults when needed.</p>
      </div>
      <div class="quick-actions">
        <a class="quick-link" href="/">Open review workspace</a>
      </div>
    </section>

    ${renderWorkflowSaveSummary(
      saveSummary,
      organizationDirectory,
      clubPolicy.club?.name || selectedClubSlug,
      normalizedSimulationInput,
      {
        organizationHistory,
        clubHistory
      }
    )}

    <section class="panel" style="margin-bottom:18px;">
      <form method="GET" action="/workflow-settings" class="workflow-policy-form workflow-policy-filter">
        ${renderPolicyField({
          label: "Club slug",
          name: "clubSlug",
          helper: "Load the policy stack for one club at a time.",
          input: `<input name="clubSlug" value="${escapeHtml(selectedClubSlug)}" placeholder="demo-soccer-club" />`
        })}
        ${renderPolicyField({
          label: "Club view",
          name: "clubView",
          helper: "Filter the organization directory to all clubs, only clubs with overrides, or only fully inheriting clubs.",
          input: `<select name="clubView">${renderPolicySelectOptions(
            [
              { value: "all", label: "All clubs" },
              { value: "overrides", label: "Overrides only" },
              { value: "inheriting", label: "Fully inheriting" }
            ],
            clubView || "all"
          )}</select>`
        })}
        ${renderPolicyField({
          label: "Policy area",
          name: "clubArea",
          helper: "Focus override cleanup on one workflow area such as routing, approvals, publishing, or notifications.",
          input: `<select name="clubArea">${renderPolicySelectOptions(
            [
              { value: "all", label: "All policy areas" },
              ...trackedPolicyAreaFields.map((area) => ({
                value: area.key,
                label: area.label
              }))
            ],
            clubArea || "all"
          )}</select>`
        })}
        <div class="policy-actions">
          <button type="submit" class="button-secondary">Load settings</button>
          <span class="subtle">Organization: ${escapeHtml(clubPolicy.organization?.name || "No organization linked")}</span>
        </div>
      </form>
    </section>

    ${renderEffectivePolicySummary({
      effectivePolicy,
      clubPolicy: previewClubPolicy,
      organizationPolicy: previewOrganizationPolicy
    })}
    ${renderPolicySimulator({
      effectivePolicy,
      liveEffectivePolicy,
      simulationInput,
      clubSlug: selectedClubSlug,
      previewContext: previewScopeType
        ? { scopeType: previewScopeType }
        : null
    })}
    ${renderPolicyHistorySection({
      organizationHistory,
      clubHistory,
      selectedClubSlug,
      simulationInput: normalizedSimulationInput,
      previewScopeType,
      previewDraftPolicy: previewDraftPolicyParam
    })}
    ${renderOrganizationDraftImpactSummary({
      previewScopeType,
      organizationPolicy,
      previewOrganizationPolicy,
      organizationDirectory: previewOrganizationDirectory,
      clubPolicyMap: stagedOrganizationClubPolicyMap,
      selectedClubSlug,
      previewCleanupAreaKey: validPreviewCleanupArea,
      previewCleanupClubSlugs: validPreviewCleanupClubSlugs,
      overrideBurdenSummary,
      simulationInput: normalizedSimulationInput
    })}
    ${renderClubOverrideSummary({
      clubPolicy: previewClubPolicy,
      organizationPolicy: previewOrganizationPolicy
    })}
    ${renderClubDraftOverrideImpactSummary({
      previewScopeType,
      organizationPolicy: previewOrganizationPolicy,
      liveClubPolicy: clubPolicy.clubPolicy || {},
      previewClubPolicy,
      selectedClubSlug,
      simulationInput: normalizedSimulationInput
    })}
    ${renderOrganizationDirectory(
      previewScopeType === "organization" ? previewOrganizationDirectory : organizationDirectory,
      clubView,
      clubArea,
      selectedClubSlug,
      normalizedSimulationInput,
      previewScopeType,
      previewDraftPolicyParam
    )}
    

    <section class="workflow-settings-grid">
      ${renderWorkflowPolicyForm({
        scopeType: "organization",
        scopeSlug: organizationSlug,
        returnClubSlug: selectedClubSlug,
        title: organizationPolicy?.organization?.name || "Organization policy unavailable",
        subtitle: organizationSlug
          ? "These defaults apply across clubs unless a club override is set."
          : "This club does not currently belong to an organization.",
        policy: previewOrganizationPolicy,
        actorEmail: reviewerEmail,
        allowInheritance: false,
        previewScopeType,
        previewAffectedClubCount:
          previewScopeType === "organization"
            ? organizationDraftImpact?.affectedClubs.length || 0
            : 0,
        previewChangedAreaCount:
          previewScopeType === "organization"
            ? organizationDraftImpact?.changedAreas.length || 0
            : 0,
        previewInsulatedClubCount:
          previewScopeType === "organization"
            ? organizationDraftImpact?.insulatedClubs.length || 0
            : 0,
        previewChangedAreaKeys:
          previewScopeType === "organization"
            ? (organizationDraftImpact?.changedAreas || []).map((area) => area.key)
            : [],
        previewCurrentOverrideClubCount:
          previewScopeType === "organization"
            ? overrideBurdenSummary?.currentOverrideClubCount || 0
            : 0,
        previewProjectedOverrideClubCount:
          previewScopeType === "organization"
            ? overrideBurdenSummary?.projectedOverrideClubCount || 0
            : 0,
        previewCurrentOverrideAreaCount:
          previewScopeType === "organization"
            ? overrideBurdenSummary?.currentOverrideAreaCount || 0
            : 0,
        previewProjectedOverrideAreaCount:
          previewScopeType === "organization"
            ? overrideBurdenSummary?.projectedOverrideAreaCount || 0
            : 0,
        previewReducingClubs:
          previewScopeType === "organization"
            ? (overrideBurdenSummary?.clubsReducingOverrides || []).map((item) => ({
                name: item.club.name,
                slug: item.club.slug,
                liveOverrideCount: item.liveOverrideCount,
                previewOverrideCount: item.previewOverrideCount
              }))
            : [],
        previewGainingClubs:
          previewScopeType === "organization"
            ? (overrideBurdenSummary?.clubsGainingOverrides || []).map((item) => ({
                name: item.club.name,
                slug: item.club.slug,
                liveOverrideCount: item.liveOverrideCount,
                previewOverrideCount: item.previewOverrideCount
              }))
            : [],
        previewWarningCount: previewScopeType === "organization" ? previewWarningCount : 0,
        previewGuardrailWarnings:
          previewScopeType === "organization" ? previewPolicyGuardrails : [],
        stagedCleanupAreaKey:
          previewScopeType === "organization" ? validPreviewCleanupArea : null,
        stagedCleanupClubSlugs:
          previewScopeType === "organization" ? validPreviewCleanupClubSlugs : [],
        simulationInput: normalizedSimulationInput
      })}
      ${renderWorkflowPolicyForm({
        scopeType: "club",
        scopeSlug: selectedClubSlug,
        returnClubSlug: selectedClubSlug,
        title: clubPolicy.club?.name || selectedClubSlug,
        subtitle: "Use club overrides only where this club needs different behavior from the organization default.",
        policy: previewClubPolicy,
        actorEmail: reviewerEmail,
        allowInheritance: true,
        previewScopeType,
        previewChangedAreaCount:
          previewScopeType === "club" ? clubDraftChangedAreas.length : 0,
        previewChangedAreaKeys:
          previewScopeType === "club"
            ? clubDraftChangedAreas.map((area) => area.key)
            : [],
        previewCurrentOverrideAreaCount:
          previewScopeType === "club"
            ? clubDraftOverrideImpact?.liveOverrideCount || 0
            : 0,
        previewProjectedOverrideAreaCount:
          previewScopeType === "club"
            ? clubDraftOverrideImpact?.previewOverrideCount || 0
            : 0,
        previewAddedAreaKeys:
          previewScopeType === "club"
            ? (clubDraftOverrideImpact?.added || []).map((area) => area.key)
            : [],
        previewRemovedAreaKeys:
          previewScopeType === "club"
            ? (clubDraftOverrideImpact?.removed || []).map((area) => area.key)
            : [],
        previewRetainedAreaKeys:
          previewScopeType === "club"
            ? (clubDraftOverrideImpact?.retained || []).map((area) => area.key)
            : [],
        previewWarningCount: previewScopeType === "club" ? previewWarningCount : 0,
        previewGuardrailWarnings:
          previewScopeType === "club" ? previewPolicyGuardrails : [],
        simulationInput: normalizedSimulationInput,
        focusedInheritanceAreaKey:
          previewScopeType === "club" ? validPreviewResetArea : null
      })}
    </section>

    <script>
      function parseOptionalRole(value) {
        return value ? value : null;
      }

      function parsePreviewClubDeltaList(value) {
        try {
          const parsed = JSON.parse(value || '[]');
          if (!Array.isArray(parsed)) {
            return [];
          }

          return parsed
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              name: String(item.name || '').trim(),
              slug: String(item.slug || '').trim(),
              liveOverrideCount: Number(item.liveOverrideCount || 0),
              previewOverrideCount: Number(item.previewOverrideCount || 0)
            }))
            .filter((item) => item.name);
        } catch {
          return [];
        }
      }

      function parsePreviewGuardrailWarnings(value) {
        try {
          const parsed = JSON.parse(value || '[]');
          if (!Array.isArray(parsed)) {
            return [];
          }

          return parsed
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              title: String(item.title || '').trim(),
              message: String(item.message || '').trim(),
              areaKey: String(item.areaKey || '').trim() || null
            }))
            .filter((item) => item.title && item.message);
        } catch {
          return [];
        }
      }

      function parseOptionalBoolean(value) {
        if (value === '') {
          return null;
        }
        return value === 'true';
      }

      function parseOptionalJson(value, allowBlankAsNull) {
        const trimmed = value.trim();
        if (!trimmed) {
          return allowBlankAsNull ? null : {};
        }
        return JSON.parse(trimmed);
      }

      function parseCommaList(value) {
        return String(value || '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }

      function parseRuleBoolean(value) {
        if (value === '') {
          return undefined;
        }
        return value === 'true';
      }

      function finalizeRuleObject(rule, allowBlankAsNull) {
        return Object.keys(rule).length ? rule : (allowBlankAsNull ? null : {});
      }

      function buildPolicyPayload(formData, allowInheritance) {
        return {
          actorEmail: String(formData.get('actorEmail') || '').trim(),
          defaultApproverRole: parseOptionalRole(String(formData.get('defaultApproverRole') || '')),
          publicApproverRole: parseOptionalRole(String(formData.get('publicApproverRole') || '')),
          mediumRiskApproverRole: parseOptionalRole(String(formData.get('mediumRiskApproverRole') || '')),
          allowAgentRouting: parseOptionalBoolean(String(formData.get('allowAgentRouting') || '')),
          autoApproveInternalLowRisk: parseOptionalBoolean(String(formData.get('autoApproveInternalLowRisk') || '')),
          autoApproveMaxRisk: String(formData.get('autoApproveMaxRisk') || '').trim() === ''
            ? null
            : Number(formData.get('autoApproveMaxRisk')),
          autoApprovalRule: buildAutoApprovalRulePayload(formData, allowInheritance),
          routingRule: buildRoutingRulePayload(formData, allowInheritance),
          approvalRule: buildApprovalRulePayload(formData, allowInheritance),
          publishingRule: buildPublishingRulePayload(formData, allowInheritance),
          notificationRule: buildNotificationRulePayload(formData, allowInheritance)
        };
      }

      function buildApprovalRulePayload(formData, allowBlankAsNull) {
        const rule = {};
        const requireSecondApproval = parseRuleBoolean(String(formData.get('approvalRuleRequireSecondApproval') || ''));
        const secondApproverRole = parseOptionalRole(String(formData.get('approvalRuleSecondApproverRole') || ''));
        const secondApprovalContentTypesRaw = String(formData.get('approvalRuleSecondApprovalContentTypes') || '').trim();

        if (requireSecondApproval !== undefined) {
          rule.requireSecondApprovalForPublic = requireSecondApproval;
        }
        if (secondApproverRole !== null) {
          rule.secondApproverRole = secondApproverRole;
        }
        if (secondApprovalContentTypesRaw) {
          rule.secondApprovalContentTypes = parseCommaList(secondApprovalContentTypesRaw);
        }

        return finalizeRuleObject(rule, allowBlankAsNull);
      }

      function buildAutoApprovalRulePayload(formData, allowBlankAsNull) {
        const rule = {};
        const allowed = parseCommaList(String(formData.get('autoApprovalAllowedContentTypes') || ''));
        const blocked = parseCommaList(String(formData.get('autoApprovalBlockedContentTypes') || ''));

        if (allowed.length) {
          rule.allowedContentTypes = allowed;
        }
        if (blocked.length) {
          rule.blockedContentTypes = blocked;
        }

        return finalizeRuleObject(rule, allowBlankAsNull);
      }

      function buildRoutingRulePayload(formData, allowBlankAsNull) {
        const rule = {};
        const contentTypeApprovers = {};
        const contentTypes = ['photo', 'video', 'text', 'mixed'];

        for (const contentType of contentTypes) {
          const fieldName = 'routingRuleApprover' + contentType[0].toUpperCase() + contentType.slice(1);
          const role = parseOptionalRole(String(formData.get(fieldName) || ''));
          if (role !== null) {
            contentTypeApprovers[contentType] = role;
          }
        }

        if (Object.keys(contentTypeApprovers).length) {
          rule.contentTypeApprovers = contentTypeApprovers;
        }

        return finalizeRuleObject(rule, allowBlankAsNull);
      }

      function buildPublishingRulePayload(formData, allowBlankAsNull) {
        const rule = {};
        const destinationsRaw = String(formData.get('publishingRuleDestinations') || '').trim();
        const internalRaw = String(formData.get('publishingRuleInternalDestinations') || '').trim();
        const publicRaw = String(formData.get('publishingRulePublicDestinations') || '').trim();
        const visibilityDestinations = {};

        if (destinationsRaw) {
          rule.destinations = parseCommaList(destinationsRaw);
        }
        if (internalRaw) {
          visibilityDestinations.internal = parseCommaList(internalRaw);
        }
        if (publicRaw) {
          visibilityDestinations.public = parseCommaList(publicRaw);
        }
        if (Object.keys(visibilityDestinations).length) {
          rule.visibilityDestinations = visibilityDestinations;
        }

        return finalizeRuleObject(rule, allowBlankAsNull);
      }

      function buildNotificationRulePayload(formData, allowBlankAsNull) {
        const rule = {};
        const email = parseRuleBoolean(String(formData.get('notificationRuleEmail') || ''));
        const push = parseRuleBoolean(String(formData.get('notificationRulePush') || ''));
        const reviewStartedEmail = parseRuleBoolean(String(formData.get('notificationRuleReviewStartedEmail') || ''));
        const reviewStartedPush = parseRuleBoolean(String(formData.get('notificationRuleReviewStartedPush') || ''));
        const publishedEmail = parseRuleBoolean(String(formData.get('notificationRulePublishedEmail') || ''));
        const publishedPush = parseRuleBoolean(String(formData.get('notificationRulePublishedPush') || ''));
        const eventChannels = {};

        if (email !== undefined) {
          rule.email = email;
        }
        if (push !== undefined) {
          rule.push = push;
        }
        if (reviewStartedEmail !== undefined || reviewStartedPush !== undefined) {
          eventChannels.submission_review_started = {};
          if (reviewStartedEmail !== undefined) {
            eventChannels.submission_review_started.email = reviewStartedEmail;
          }
          if (reviewStartedPush !== undefined) {
            eventChannels.submission_review_started.push = reviewStartedPush;
          }
        }
        if (publishedEmail !== undefined || publishedPush !== undefined) {
          eventChannels.submission_published = {};
          if (publishedEmail !== undefined) {
            eventChannels.submission_published.email = publishedEmail;
          }
          if (publishedPush !== undefined) {
            eventChannels.submission_published.push = publishedPush;
          }
        }
        if (Object.keys(eventChannels).length) {
          rule.eventChannels = eventChannels;
        }

        return finalizeRuleObject(rule, allowBlankAsNull);
      }

      async function submitPolicyForm(form) {
        const scopeType = form.dataset.scopeType;
        const scopeSlug = form.dataset.scopeSlug;
        const status = form.querySelector('[data-policy-status]');
        const formData = new FormData(form);
        const allowInheritance = scopeType === 'club';

        if (!scopeSlug) {
          status.textContent = 'This scope is not available for the selected club.';
          return;
        }

        let payload;
        try {
          payload = buildPolicyPayload(formData, allowInheritance);
        } catch (error) {
          status.textContent = 'Fix the policy fields before saving.';
          return;
        }

        if (!payload.actorEmail) {
          status.textContent = 'Actor email is required.';
          return;
        }

        const previewAffectedClubCount = Number(form.dataset.previewAffectedClubCount || '0');
        const previewChangedAreaCount = Number(form.dataset.previewChangedAreaCount || '0');
        const previewInsulatedClubCount = Number(form.dataset.previewInsulatedClubCount || '0');
        const previewChangedAreaKeys = String(form.dataset.previewChangedAreaKeys || '').trim();
        const previewCurrentOverrideClubCount = Number(form.dataset.previewCurrentOverrideClubCount || '0');
        const previewProjectedOverrideClubCount = Number(form.dataset.previewProjectedOverrideClubCount || '0');
        const previewCurrentOverrideAreaCount = Number(form.dataset.previewCurrentOverrideAreaCount || '0');
        const previewProjectedOverrideAreaCount = Number(form.dataset.previewProjectedOverrideAreaCount || '0');
        const previewAddedAreaKeys = String(form.dataset.previewAddedAreaKeys || '').trim();
        const previewRemovedAreaKeys = String(form.dataset.previewRemovedAreaKeys || '').trim();
        const previewRetainedAreaKeys = String(form.dataset.previewRetainedAreaKeys || '').trim();
        const previewReducingClubs = parsePreviewClubDeltaList(form.dataset.previewReducingClubs);
        const previewGainingClubs = parsePreviewClubDeltaList(form.dataset.previewGainingClubs);
        const previewGuardrailWarnings = parsePreviewGuardrailWarnings(
          form.dataset.previewGuardrailWarnings
        );
        const previewCleanupAreaKey = String(form.dataset.previewCleanupAreaKey || '').trim();
        const previewCleanupClubSlugs = String(form.dataset.previewCleanupClubSlugs || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        const returnClubSlug = String(form.dataset.returnClubSlug || scopeSlug || '').trim();
        if (scopeType === 'organization' && previewAffectedClubCount > 0) {
          const confirmed = window.confirm(
            'This organization draft changes ' +
              previewChangedAreaCount +
              ' policy area' +
              (previewChangedAreaCount === 1 ? '' : 's') +
              ' across ' +
              previewAffectedClubCount +
              ' club' +
              (previewAffectedClubCount === 1 ? '' : 's') +
              '. Save anyway?'
          );
          if (!confirmed) {
            status.textContent = 'Save cancelled. Review the organization rollout impact above.';
            return;
          }
        }

        const previewWarningCount = Number(form.dataset.previewWarningCount || '0');
        if (previewWarningCount > 0) {
          const confirmed = window.confirm(
            'This draft has ' +
              previewWarningCount +
              ' simulated workflow warning' +
              (previewWarningCount === 1 ? '' : 's') +
              '. Save anyway?'
          );
          if (!confirmed) {
            status.textContent = 'Save cancelled. Review the warnings above.';
            return;
          }
        }

        status.textContent = 'Saving...';
        const response = await fetch(
          scopeType === 'organization' && previewCleanupAreaKey && previewCleanupClubSlugs.length
            ? '/ui/workflow-policies/organizations/' + encodeURIComponent(scopeSlug) + '/save-with-cleanup'
            : '/ui/workflow-policies/' + scopeType + 's/' + encodeURIComponent(scopeSlug),
          {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            scopeType === 'organization' && previewCleanupAreaKey && previewCleanupClubSlugs.length
              ? {
                  ...payload,
                  cleanupAreaKey: previewCleanupAreaKey,
                  cleanupClubSlugs: previewCleanupClubSlugs
                }
              : payload
          )
        });
        const result = await response.json();

        if (!response.ok) {
          status.textContent = result.error || 'Save failed';
          return;
        }

        const simulatorForm = document.querySelector('form[action="/workflow-settings"]:not([data-scope-type])');
        const simulatorData = simulatorForm ? new FormData(simulatorForm) : new FormData();
        status.textContent = 'Saved. Reloading effective policy...';
        if (scopeType === 'organization') {
          const params = new URLSearchParams();
          params.set('clubSlug', returnClubSlug || scopeSlug);
          appendSimulatorParams(params, simulatorData);
          params.set('saveScopeType', 'organization');
          params.set('saveChangedAreaCount', String(previewChangedAreaCount));
          params.set('saveAffectedClubCount', String(previewAffectedClubCount));
          params.set('saveInsulatedClubCount', String(previewInsulatedClubCount));
          params.set('saveCurrentOverrideClubCount', String(previewCurrentOverrideClubCount));
          params.set('saveProjectedOverrideClubCount', String(previewProjectedOverrideClubCount));
          params.set('saveCurrentOverrideAreaCount', String(previewCurrentOverrideAreaCount));
          params.set('saveProjectedOverrideAreaCount', String(previewProjectedOverrideAreaCount));
          params.set('saveReducingClubs', JSON.stringify(previewReducingClubs));
          params.set('saveGainingClubs', JSON.stringify(previewGainingClubs));
          params.set('saveGuardrailWarnings', JSON.stringify(previewGuardrailWarnings));
          if (previewCleanupAreaKey && previewCleanupClubSlugs.length) {
            params.set('saveCleanupAreaKey', previewCleanupAreaKey);
            params.set(
              'saveCleanedClubs',
              JSON.stringify(
                previewCleanupClubSlugs.map((slug) => ({
                  slug,
                  name: slug
                }))
              )
            );
          }
          if (previewChangedAreaKeys) {
            params.set('saveChangedAreaKeys', previewChangedAreaKeys);
          }
          window.location.assign(
            result.redirectUrl || '/workflow-settings?' + params.toString()
          );
          return;
        }

        if (scopeType === 'club') {
          const params = new URLSearchParams();
          params.set('clubSlug', returnClubSlug || scopeSlug);
          appendSimulatorParams(params, simulatorData);
          params.set('saveScopeType', 'club');
          params.set('saveChangedAreaCount', String(previewChangedAreaCount));
          params.set('saveCurrentOverrideAreaCount', String(previewCurrentOverrideAreaCount));
          params.set('saveProjectedOverrideAreaCount', String(previewProjectedOverrideAreaCount));
          if (previewChangedAreaKeys) {
            params.set('saveChangedAreaKeys', previewChangedAreaKeys);
          }
          if (previewAddedAreaKeys) {
            params.set('saveAddedAreaKeys', previewAddedAreaKeys);
          }
          if (previewRemovedAreaKeys) {
            params.set('saveRemovedAreaKeys', previewRemovedAreaKeys);
          }
          if (previewRetainedAreaKeys) {
            params.set('saveRetainedAreaKeys', previewRetainedAreaKeys);
          }
          window.location.assign('/workflow-settings?' + params.toString());
          return;
        }

        window.location.reload();
      }

      function appendSimulatorParams(params, simulatorData) {
        params.set('simulationContentType', String(simulatorData.get('simulationContentType') || 'video'));
        params.set('simulationVisibilityTarget', String(simulatorData.get('simulationVisibilityTarget') || 'public'));
        params.set('simulationRiskScore', String(simulatorData.get('simulationRiskScore') || '0.42'));
        params.set('simulationModerationFlagged', String(simulatorData.get('simulationModerationFlagged') || 'false'));
        if (String(simulatorData.get('simulationAgentSuggestedApproverRole') || '').trim()) {
          params.set(
            'simulationAgentSuggestedApproverRole',
            String(simulatorData.get('simulationAgentSuggestedApproverRole') || '').trim()
          );
        }
      }

      function previewPolicyDraft(form) {
        const scopeType = form.dataset.scopeType;
        const scopeSlug = form.dataset.scopeSlug;
        const status = form.querySelector('[data-policy-status]');
        const formData = new FormData(form);
        const simulatorForm = document.querySelector('form[action="/workflow-settings"]:not([data-scope-type])');
        const simulatorData = simulatorForm ? new FormData(simulatorForm) : new FormData();
        const allowInheritance = scopeType === 'club';

        if (!scopeSlug) {
          if (status) {
            status.textContent = 'This scope is not available for the selected club.';
          }
          return;
        }

        let payload;
        try {
          payload = buildPolicyPayload(formData, allowInheritance);
        } catch (error) {
          if (status) {
            status.textContent = 'Fix the policy fields before previewing.';
          }
          return;
        }

        const params = new URLSearchParams();
        params.set('clubSlug', String(simulatorData.get('clubSlug') || scopeSlug));
        appendSimulatorParams(params, simulatorData);
        params.set('previewScopeType', scopeType);
        params.set('previewDraftPolicy', JSON.stringify(payload));
        window.location.assign('/workflow-settings?' + params.toString());
      }

      function resetInheritedPolicyDraft(form) {
        const status = form.querySelector('[data-policy-status]');
        const actorEmail = form.querySelector('[name="actorEmail"]');

        form
          .querySelectorAll('input:not([name="actorEmail"]), select')
          .forEach((field) => {
            if (field.tagName === 'SELECT') {
              field.value = '';
              return;
            }

            if (field.type === 'number' || field.type === 'text' || field.type === 'email') {
              field.value = '';
            }
          });

        if (actorEmail && !actorEmail.value.trim()) {
          actorEmail.focus();
        }

        if (status) {
          status.textContent =
            'Club draft reset to inherited organization defaults. Preview or save when ready.';
        }
      }

      function resetPolicyArea(form, fieldNames, areaLabel) {
        const status = form.querySelector('[data-policy-status]');
        const actorEmail = form.querySelector('[name="actorEmail"]');

        fieldNames.forEach((fieldName) => {
          const field = form.querySelector('[name="' + CSS.escape(fieldName) + '"]');
          if (!field) {
            return;
          }

          if (field.tagName === 'SELECT') {
            field.value = '';
            return;
          }

          if (field.type === 'number' || field.type === 'text' || field.type === 'email') {
            field.value = '';
          }
        });

        if (actorEmail && !actorEmail.value.trim()) {
          actorEmail.focus();
        }

        if (status) {
          status.textContent =
            areaLabel +
            ' reset to inherit the organization default. Preview or save when ready.';
        }
      }

      document.querySelectorAll('.workflow-policy-form[data-scope-type]').forEach((form) => {
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          submitPolicyForm(form).catch((error) => {
            const status = form.querySelector('[data-policy-status]');
            if (status) {
              status.textContent = error.message || 'Save failed';
            }
          });
        });

        const previewButton = form.querySelector('[data-preview-policy]');
        if (previewButton) {
          previewButton.addEventListener('click', () => {
            previewPolicyDraft(form);
          });
        }

        const resetButton = form.querySelector('[data-reset-inheritance]');
        if (resetButton) {
          resetButton.addEventListener('click', () => {
            resetInheritedPolicyDraft(form);
          });
        }

        form.querySelectorAll('[data-reset-area-fields]').forEach((button) => {
          button.addEventListener('click', () => {
            let fieldNames = [];
            try {
              fieldNames = JSON.parse(button.dataset.resetAreaFields || '[]');
            } catch {
              fieldNames = [];
            }

            resetPolicyArea(
              form,
              Array.isArray(fieldNames) ? fieldNames : [],
              String(button.dataset.resetAreaLabel || 'This area')
            );
          });
        });
      });

      document.querySelectorAll('.workflow-bulk-inherit-form').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const status = form.querySelector('[data-bulk-status]');
          const areaKey = String(form.querySelector('[name="areaKey"]')?.value || '').trim();
          const organizationSlug = String(form.dataset.organizationSlug || '').trim();
          const returnClubSlug = String(form.querySelector('[name="returnClubSlug"]')?.value || '').trim();
          const actorEmail = String(
            document.querySelector('.workflow-policy-form[data-scope-type="organization"] [name="actorEmail"]')?.value || ''
          ).trim();
          const clubSlugs = Array.from(form.querySelectorAll('input[name="clubSlugs"]:checked'))
            .map((input) => String(input.value || '').trim())
            .filter(Boolean);
          const simulatorForm = document.querySelector('form[action="/workflow-settings"]:not([data-scope-type])');
          const simulatorData = simulatorForm ? new FormData(simulatorForm) : new FormData();

          if (!organizationSlug || !areaKey) {
            if (status) status.textContent = 'This cleanup action is not available right now.';
            return;
          }

          if (!actorEmail) {
            if (status) status.textContent = 'Enter the organization actor email before running bulk cleanup.';
            document
              .querySelector('.workflow-policy-form[data-scope-type="organization"] [name="actorEmail"]')
              ?.focus();
            return;
          }

          if (!clubSlugs.length) {
            if (status) status.textContent = 'Select at least one club for bulk cleanup.';
            return;
          }

          const confirmed = window.confirm(
            'Apply the organization default for this area to ' +
              clubSlugs.length +
              ' club' +
              (clubSlugs.length === 1 ? '' : 's') +
              '?'
          );
          if (!confirmed) {
            if (status) status.textContent = 'Bulk cleanup cancelled.';
            return;
          }

          if (status) status.textContent = 'Applying organization default...';
          const response = await fetch(
            '/ui/workflow-policies/organizations/' + encodeURIComponent(organizationSlug) + '/bulk-inherit-area',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                actorEmail,
                areaKey,
                clubSlugs,
                returnClubSlug,
                simulationInput: {
                  contentType: String(simulatorData.get('simulationContentType') || ''),
                  visibilityTarget: String(simulatorData.get('simulationVisibilityTarget') || ''),
                  riskScore: String(simulatorData.get('simulationRiskScore') || ''),
                  moderationFlagged: String(simulatorData.get('simulationModerationFlagged') || ''),
                  agentSuggestedApproverRole: String(
                    simulatorData.get('simulationAgentSuggestedApproverRole') || ''
                  ).trim()
                }
              })
            }
          );
          const result = await response.json();
          if (!response.ok) {
            if (status) status.textContent = result.error || 'Bulk cleanup failed';
            return;
          }

          if (status) status.textContent = 'Saved. Reloading cleanup summary...';
          window.location.assign(result.redirectUrl || '/workflow-settings');
        });
      });
    </script>
  `, "Club Content Workflow Settings");
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

export function buildHealthPayload() {
  return {
    service: "admin-web",
    status: "ok"
  };
}

export function createAdminServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(buildHealthPayload()));
        return;
      }

      if (!isAuthorized(req)) {
        requestAuth(res);
        return;
      }

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

      if (req.method === "GET" && url.pathname === "/workflow-settings") {
        const saveScopeType = url.searchParams.get("saveScopeType");
        const saveSummary =
          saveScopeType === "organization"
            ? {
                scopeType: "organization",
                clubSlug: url.searchParams.get("clubSlug") || "",
                changedAreaCount: Number(url.searchParams.get("saveChangedAreaCount") || "0"),
                affectedClubCount: Number(url.searchParams.get("saveAffectedClubCount") || "0"),
                insulatedClubCount: Number(url.searchParams.get("saveInsulatedClubCount") || "0"),
                currentOverrideClubCount: Number(
                  url.searchParams.get("saveCurrentOverrideClubCount") || "0"
                ),
                projectedOverrideClubCount: Number(
                  url.searchParams.get("saveProjectedOverrideClubCount") || "0"
                ),
                currentOverrideAreaCount: Number(
                  url.searchParams.get("saveCurrentOverrideAreaCount") || "0"
                ),
                projectedOverrideAreaCount: Number(
                  url.searchParams.get("saveProjectedOverrideAreaCount") || "0"
                ),
                reducingClubs: parseSavedClubDeltaList(
                  url.searchParams.get("saveReducingClubs")
                ),
                gainingClubs: parseSavedClubDeltaList(
                  url.searchParams.get("saveGainingClubs")
                ),
                guardrailWarnings: parseGuardrailWarningList(
                  url.searchParams.get("saveGuardrailWarnings")
                ),
                cleanupAreaKey: url.searchParams.get("saveCleanupAreaKey") || "",
                cleanedClubs: parseSavedClubDeltaList(
                  url.searchParams.get("saveCleanedClubs")
                ),
                changedAreaKeys: String(url.searchParams.get("saveChangedAreaKeys") || "")
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)
              }
            : saveScopeType === "organization_cleanup"
              ? {
                  scopeType: "organization_cleanup",
                  clubSlug: url.searchParams.get("clubSlug") || "",
                  cleanupAreaKey: url.searchParams.get("saveCleanupAreaKey") || "",
                  currentOverrideClubCount: Number(
                    url.searchParams.get("saveCurrentOverrideClubCount") || "0"
                  ),
                  projectedOverrideClubCount: Number(
                    url.searchParams.get("saveProjectedOverrideClubCount") || "0"
                  ),
                  currentOverrideAreaCount: Number(
                    url.searchParams.get("saveCurrentOverrideAreaCount") || "0"
                  ),
                  projectedOverrideAreaCount: Number(
                    url.searchParams.get("saveProjectedOverrideAreaCount") || "0"
                  ),
                  cleanedClubs: parseSavedClubDeltaList(
                    url.searchParams.get("saveCleanedClubs")
                  )
                }
            : saveScopeType === "club"
              ? {
                  scopeType: "club",
                  clubSlug: url.searchParams.get("clubSlug") || "",
                  changedAreaCount: Number(
                    url.searchParams.get("saveChangedAreaCount") || "0"
                  ),
                  currentOverrideAreaCount: Number(
                    url.searchParams.get("saveCurrentOverrideAreaCount") || "0"
                  ),
                  projectedOverrideAreaCount: Number(
                    url.searchParams.get("saveProjectedOverrideAreaCount") || "0"
                  ),
                  changedAreaKeys: String(url.searchParams.get("saveChangedAreaKeys") || "")
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  addedAreaKeys: String(url.searchParams.get("saveAddedAreaKeys") || "")
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  removedAreaKeys: String(url.searchParams.get("saveRemovedAreaKeys") || "")
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  retainedAreaKeys: String(url.searchParams.get("saveRetainedAreaKeys") || "")
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                }
            : null;
        const html = await renderWorkflowSettingsPage(url.searchParams.get("clubSlug"), {
          contentType: url.searchParams.get("simulationContentType"),
          visibilityTarget: url.searchParams.get("simulationVisibilityTarget"),
          riskScore: url.searchParams.get("simulationRiskScore"),
          moderationFlagged: url.searchParams.get("simulationModerationFlagged"),
          agentSuggestedApproverRole: url.searchParams.get("simulationAgentSuggestedApproverRole")
        }, {
          scopeType: url.searchParams.get("previewScopeType"),
          payload: parsePreviewDraft(url.searchParams.get("previewDraftPolicy"))
        }, url.searchParams.get("clubView"), url.searchParams.get("clubArea"), saveSummary, url.searchParams.get("previewResetArea"), url.searchParams.get("previewCleanupArea"), String(url.searchParams.get("previewCleanupClubs") || "").split(",").map((value) => value.trim()).filter(Boolean));
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

      if (req.method === "GET" && /^\/ui\/submissions\/[^/]+$/.test(url.pathname)) {
        const submissionId = url.pathname.split("/")[3];
        const payload = await fetchJson(`/submissions/${submissionId}`);
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

      if (
        req.method === "POST" &&
        /^\/ui\/workflow-policies\/(clubs|organizations)\/[^/]+$/.test(url.pathname)
      ) {
        const [, , , resourceType, scopeSlug] = url.pathname.split("/");
        const body = await readJson(req);
        const payload = await fetchJson(`/workflow-policies/${resourceType}/${scopeSlug}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }

      if (
        req.method === "POST" &&
        /^\/ui\/workflow-policies\/organizations\/[^/]+\/save-with-cleanup$/.test(url.pathname)
      ) {
        const organizationSlug = decodeURIComponent(url.pathname.split("/")[4]);
        const body = await readJson(req);
        const actorEmail = String(body.actorEmail || "").trim();
        const cleanupAreaKey = String(body.cleanupAreaKey || "").trim();
        const cleanupClubSlugs = Array.isArray(body.cleanupClubSlugs)
          ? body.cleanupClubSlugs.map((value) => String(value || "").trim()).filter(Boolean)
          : [];

        if (!actorEmail) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "actorEmail is required" }));
          return;
        }

        const cleanupClubs =
          cleanupAreaKey && cleanupClubSlugs.length
            ? (() => {
                return fetchJson(`/organizations/${encodeURIComponent(organizationSlug)}`)
                  .then((directory) => {
                    const nameBySlug = new Map(
                      (directory?.clubs || []).map((club) => [club.slug, club.name || club.slug])
                    );

                    return cleanupClubSlugs.map((slug) => ({
                      slug,
                      name: nameBySlug.get(slug) || slug
                    }));
                  })
                  .catch(() =>
                    cleanupClubSlugs.map((slug) => ({
                      slug,
                      name: slug
                    }))
                  );
              })()
            : Promise.resolve([]);
        const resolvedCleanupClubs = await cleanupClubs;
        const { cleanupAreaKey: _cleanupAreaKey, cleanupClubSlugs: _cleanupClubSlugs, ...policyPayload } = body;
        const policyResult = await fetchJson(
          `/workflow-policies/organizations/${encodeURIComponent(organizationSlug)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...policyPayload,
              historyContext:
                cleanupAreaKey && resolvedCleanupClubs.length
                  ? {
                      cleanupSummary: {
                        areaKey: cleanupAreaKey,
                        clubs: resolvedCleanupClubs
                      }
                    }
                  : undefined
            })
          }
        );

        if (cleanupAreaKey && cleanupClubSlugs.length) {
          for (const clubSlug of cleanupClubSlugs) {
            await fetchJson(`/workflow-policies/clubs/${encodeURIComponent(clubSlug)}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                actorEmail,
                [cleanupAreaKey]: null
              })
            });
          }
        }

        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            organization: policyResult.organization || null
          })
        );
        return;
      }

      if (
        req.method === "POST" &&
        /^\/ui\/workflow-policies\/organizations\/[^/]+\/bulk-inherit-area$/.test(url.pathname)
      ) {
        const organizationSlug = decodeURIComponent(url.pathname.split("/")[4]);
        const body = await readJson(req);
        const actorEmail = String(body.actorEmail || "").trim();
        const areaKey = String(body.areaKey || "").trim();
        const returnClubSlug = String(body.returnClubSlug || "").trim();
        const simulationInput =
          body.simulationInput && typeof body.simulationInput === "object"
            ? body.simulationInput
            : {};
        const requestedClubSlugs = Array.isArray(body.clubSlugs)
          ? body.clubSlugs.map((value) => String(value || "").trim()).filter(Boolean)
          : [];

        if (!actorEmail) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "actorEmail is required" }));
          return;
        }

        if (!trackedPolicyAreaFields.find((area) => area.key === areaKey)) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "A valid areaKey is required" }));
          return;
        }

        if (!requestedClubSlugs.length) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Select at least one club to clean up" }));
          return;
        }

        const organizationPolicy = await fetchJson(
          `/workflow-policies/organizations/${encodeURIComponent(organizationSlug)}`
        );
        const organizationDirectory = await fetchJson(
          `/organizations/${encodeURIComponent(organizationSlug)}`
        );
        const currentClubPolicyMap = await fetchOrganizationClubPolicyMap({
          organizationDirectory,
          selectedClubSlug: "",
          selectedClubPolicy: null
        });
        const knownClubs = new Map(
          (organizationDirectory?.clubs || []).map((club) => [club.slug, club])
        );
        const targetedClubs = requestedClubSlugs
          .map((slug) => knownClubs.get(slug) || null)
          .filter(Boolean);

        if (!targetedClubs.length) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "No valid clubs were selected for this organization" }));
          return;
        }

        const organizationPolicyValue = organizationPolicy?.organizationPolicy || {};
        const actionableClubs = targetedClubs.filter((club) => {
          const clubPolicy = currentClubPolicyMap?.[club.slug]?.clubPolicy || {};
          const liveSummary = buildClubOverrideSummary({
            clubPolicy,
            organizationPolicy: organizationPolicyValue
          });
          const previewSummary = buildClubOverrideSummary({
            clubPolicy: {
              ...clubPolicy,
              [areaKey]: null
            },
            organizationPolicy: organizationPolicyValue
          });

          return previewSummary.overridden.length < liveSummary.overridden.length;
        });

        if (!actionableClubs.length) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Selected clubs are already inheriting this area" }));
          return;
        }

        const currentSummary = buildOrganizationOverrideBurdenSummaryFromClubPolicyMap({
          organizationDirectory,
          organizationPolicy: organizationPolicyValue,
          clubPolicyMap: currentClubPolicyMap
        });
        const projectedClubPolicyMap = Object.fromEntries(
          Object.entries(currentClubPolicyMap).map(([slug, value]) => [
            slug,
            actionableClubs.find((club) => club.slug === slug)
              ? {
                  ...value,
                  clubPolicy: {
                    ...(value?.clubPolicy || {}),
                    [areaKey]: null
                  }
                }
              : value
          ])
        );
        const projectedSummary = buildOrganizationOverrideBurdenSummaryFromClubPolicyMap({
          organizationDirectory,
          organizationPolicy: organizationPolicyValue,
          clubPolicyMap: projectedClubPolicyMap
        });

        for (const club of actionableClubs) {
          await fetchJson(`/workflow-policies/clubs/${encodeURIComponent(club.slug)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              actorEmail,
              [areaKey]: null
            })
          });
        }

        const params = new URLSearchParams();
        params.set("clubSlug", returnClubSlug || actionableClubs[0]?.slug || "");
        params.set("saveScopeType", "organization_cleanup");
        params.set("saveCleanupAreaKey", areaKey);
        params.set(
          "saveCurrentOverrideClubCount",
          String(currentSummary.currentOverrideClubCount)
        );
        params.set(
          "saveProjectedOverrideClubCount",
          String(projectedSummary.currentOverrideClubCount)
        );
        params.set(
          "saveCurrentOverrideAreaCount",
          String(currentSummary.currentOverrideAreaCount)
        );
        params.set(
          "saveProjectedOverrideAreaCount",
          String(projectedSummary.currentOverrideAreaCount)
        );
        params.set(
          "saveCleanedClubs",
          JSON.stringify(
            actionableClubs.map((club) => ({
              name: club.name,
              slug: club.slug
            }))
          )
        );
        if (simulationInput?.contentType) {
          params.set("simulationContentType", String(simulationInput.contentType));
        }
        if (simulationInput?.visibilityTarget) {
          params.set(
            "simulationVisibilityTarget",
            String(simulationInput.visibilityTarget)
          );
        }
        if (simulationInput?.riskScore !== undefined && simulationInput?.riskScore !== null) {
          params.set("simulationRiskScore", String(simulationInput.riskScore));
        }
        if (
          simulationInput?.moderationFlagged !== undefined &&
          simulationInput?.moderationFlagged !== null
        ) {
          params.set(
            "simulationModerationFlagged",
            String(simulationInput.moderationFlagged)
          );
        }
        if (simulationInput?.agentSuggestedApproverRole) {
          params.set(
            "simulationAgentSuggestedApproverRole",
            String(simulationInput.agentSuggestedApproverRole)
          );
        }
        params.set("clubView", "overrides");
        params.set("clubArea", areaKey);

        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            redirectUrl: `/workflow-settings?${params.toString()}`
          })
        );
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
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const server = createAdminServer();
  server.listen(port, () => {
    console.log(`admin-web listening on ${port}`);
  });
}
