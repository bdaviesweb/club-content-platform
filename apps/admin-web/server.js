import http from "node:http";

const port = 3001;
const apiBase = process.env.API_BASE_URL || "http://app-api:4000";

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
        --bg: #f4efe5;
        --paper: rgba(255, 251, 244, 0.96);
        --paper-2: rgba(255, 255, 255, 0.72);
        --ink: #14261d;
        --muted: #66756d;
        --line: #ddd3c0;
        --line-strong: #cbbca1;
        --green: #176744;
        --green-soft: #dceddf;
        --amber: #9b611b;
        --amber-soft: #f7ead7;
        --red: #8a352d;
        --red-soft: #f6dfdc;
        --blue-soft: #ddeaf2;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, serif;
        background:
          radial-gradient(circle at top left, rgba(23, 103, 68, 0.12), transparent 24%),
          radial-gradient(circle at top right, rgba(155, 97, 27, 0.12), transparent 22%),
          linear-gradient(180deg, #fbf7ef 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        max-width: 1320px;
        margin: 0 auto;
        padding: 28px 18px 40px;
      }
      h1, h2, h3, p { margin: 0; }
      .hero {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 20px;
      }
      .hero h1 {
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1.02;
      }
      .eyebrow {
        color: var(--green);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.8rem;
        margin-bottom: 6px;
        font-weight: 700;
      }
      .subtle { color: var(--muted); }
      .topline {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .metric, .panel, .queue-card, .feed-card {
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 20px;
        box-shadow: 0 16px 34px rgba(20, 38, 29, 0.08);
      }
      .metric {
        padding: 14px 16px;
      }
      .metric-label {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.75rem;
        margin-bottom: 6px;
      }
      .metric strong {
        display: block;
        font-size: 1.4rem;
      }
      .workspace {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 18px;
        align-items: start;
      }
      .panel {
        padding: 16px;
      }
      .queue-panel {
        position: sticky;
        top: 18px;
      }
      .queue-list {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .queue-card {
        display: block;
        text-decoration: none;
        color: inherit;
        padding: 14px;
        background: var(--paper-2);
        border-radius: 16px;
      }
      .queue-card.active {
        border-color: var(--green);
        box-shadow: inset 0 0 0 2px rgba(23, 103, 68, 0.16);
      }
      .queue-card:hover {
        border-color: var(--line-strong);
      }
      .queue-row,
      .header-row,
      .badge-row,
      .decision-actions,
      .chip-row,
      .content-meta {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
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
      .badge-neutral { background: rgba(102, 117, 109, 0.12); color: var(--muted); }
      .badge-review { background: var(--amber-soft); color: var(--amber); }
      .badge-good { background: var(--green-soft); color: var(--green); }
      .badge-alert { background: var(--red-soft); color: var(--red); }
      .review-flow {
        display: grid;
        gap: 16px;
      }
      .focus-panel {
        padding: 18px;
      }
      .recommendation {
        border-radius: 18px;
        border: 1px solid var(--line);
        padding: 16px;
      }
      .recommendation-approve { background: linear-gradient(180deg, #eef8f1 0%, #fbfdfb 100%); border-color: #cfe4d5; }
      .recommendation-revise { background: linear-gradient(180deg, #fff4e7 0%, #fffdfa 100%); border-color: #ecd2ad; }
      .recommendation-reject { background: linear-gradient(180deg, #fdebea 0%, #fffaf9 100%); border-color: #e6c2bd; }
      .recommendation-label {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 8px;
        color: var(--muted);
        font-weight: 700;
      }
      .recommendation h2 {
        font-size: clamp(1.8rem, 3vw, 2.5rem);
        margin-bottom: 8px;
      }
      .recommendation p + p { margin-top: 10px; }
      .focus-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
        gap: 16px;
      }
      .focus-block {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px;
        background: var(--paper-2);
      }
      .focus-block h3 {
        margin-bottom: 10px;
      }
      .content-copy {
        font-size: 1.15rem;
        line-height: 1.5;
        margin-bottom: 14px;
      }
      .summary-list {
        display: grid;
        gap: 10px;
      }
      .summary-item {
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.76);
      }
      .summary-item strong {
        display: block;
        margin-bottom: 4px;
      }
      .history-list {
        display: grid;
        gap: 10px;
      }
      .history-item {
        border-left: 3px solid var(--line-strong);
        padding-left: 12px;
      }
      details.disclosure {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--paper-2);
        padding: 0;
      }
      details.disclosure summary {
        list-style: none;
        cursor: pointer;
        padding: 14px;
        font-weight: 700;
      }
      details.disclosure summary::-webkit-details-marker {
        display: none;
      }
      details.disclosure[open] summary {
        border-bottom: 1px solid var(--line);
      }
      .disclosure-body {
        padding: 14px;
      }
      .decision-panel {
        position: sticky;
        bottom: 14px;
        padding: 16px;
        border: 1px solid var(--line-strong);
        background: rgba(255, 251, 244, 0.98);
      }
      .decision-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .decision-option {
        border-radius: 16px;
        border: 1px solid var(--line);
        padding: 14px;
        background: #fff;
        cursor: pointer;
        text-align: left;
      }
      .decision-option.active {
        border-color: var(--green);
        box-shadow: inset 0 0 0 2px rgba(23, 103, 68, 0.14);
      }
      .decision-option.reject.active {
        border-color: var(--red);
        box-shadow: inset 0 0 0 2px rgba(138, 53, 45, 0.14);
      }
      .decision-option.revise.active {
        border-color: var(--amber);
        box-shadow: inset 0 0 0 2px rgba(155, 97, 27, 0.14);
      }
      .decision-option strong {
        display: block;
        margin-bottom: 6px;
      }
      input[type="text"], textarea {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: #fff;
        font: inherit;
        padding: 12px 14px;
      }
      textarea {
        min-height: 96px;
        resize: vertical;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 11px 16px;
        font: inherit;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.55;
        cursor: wait;
      }
      .button-primary { background: var(--green); color: white; }
      .button-secondary { background: var(--paper-2); color: var(--ink); border: 1px solid var(--line); }
      .button-danger { background: var(--red); color: white; }
      .button-warn { background: var(--amber); color: white; }
      .chip {
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.74);
        border-radius: 999px;
        padding: 8px 12px;
        cursor: pointer;
      }
      .decision-support {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .decision-copy {
        min-height: 22px;
      }
      .hidden { display: none; }
      .footer-panels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      .feed-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }
      .feed-card {
        padding: 14px;
        background: var(--paper-2);
      }
      @media (max-width: 980px) {
        .topline,
        .focus-grid,
        .decision-grid,
        .footer-panels,
        .workspace {
          grid-template-columns: 1fr;
        }
        .queue-panel,
        .decision-panel {
          position: static;
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
      const preview = item.latest_review_summary || item.raw_text || "No reviewer summary yet.";
      return `<a class="queue-card${active}" href="/?approvalRequestId=${encodeURIComponent(item.id)}">
        <div class="header-row">
          <strong>${index === 0 ? "Up next" : `Queue ${index + 1}`}</strong>
          ${renderStatusBadge(band.label, band.className === "tone-high" ? "alert" : band.className === "tone-mid" ? "review" : "good")}
        </div>
        <div class="badge-row" style="margin-top:8px;">
          ${renderStatusBadge(formatLabel(item.submission_status), "review")}
          <span class="subtle">${escapeHtml(formatRelativeTime(item.created_at))}</span>
        </div>
        <p style="margin-top:10px; line-height:1.45;">${escapeHtml(preview)}</p>
      </a>`;
    })
    .join("");

  return `<div class="panel queue-panel">
    <h2>Review Queue</h2>
    <p class="subtle" style="margin-top:8px;">Move top to bottom. The goal is fast, confident decisions, not full record inspection.</p>
    <div class="queue-list">${cards}</div>
  </div>`;
}

function renderFooterPanels(feed, failedEvents) {
  const feedCards = feed.length
    ? feed
        .slice(0, 4)
        .map(
          (item) => `<div class="feed-card">
            <div class="header-row">
              <strong>${escapeHtml(item.destination_name)}</strong>
              ${renderStatusBadge(formatLabel(item.content_type), "neutral")}
            </div>
            <p style="margin-top:10px;">${escapeHtml(item.caption_draft || item.raw_text || "No caption.")}</p>
            <p class="subtle" style="margin-top:8px;">${escapeHtml(item.submission_id)}</p>
          </div>`
        )
        .join("")
    : `<p class="subtle">Nothing has been published yet.</p>`;

  const eventCards = failedEvents.length
    ? failedEvents
        .map(
          (item) => `<div class="feed-card">
            <div class="header-row">
              <strong>${escapeHtml(item.event_name)}</strong>
              ${renderStatusBadge(formatLabel(item.submission_status || "n/a"), "neutral")}
            </div>
            <p style="margin-top:8px;">${escapeHtml(item.processing_error || "No error recorded.")}</p>
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
      <div class="feed-grid" style="margin-top:12px;">${feedCards}</div>
    </div>
    <div class="panel">
      <h3>Workflow Recovery</h3>
      <div class="feed-grid" style="margin-top:12px;">${eventCards}</div>
      <p id="event-status" class="subtle" style="margin-top:12px;"></p>
    </div>
  </div>`;
}

function renderFocus(detail, queueIds) {
  if (!detail) {
    return `<div class="panel"><h2>No item selected</h2><p class="subtle" style="margin-top:8px;">Pick a queued item to review it.</p></div>`;
  }

  const recommendation = recommendationFor(detail);
  const risk = riskBand(detail.risk_score);
  const queuePosition = Math.max(queueIds.indexOf(detail.id), 0) + 1;
  const mediaSummary = detail.media.length
    ? detail.media.map((item) => `${item.mediaType}: ${item.objectKey}`).join("\n")
    : "No media metadata attached.";
  const reviewSignals = detail.review_runs.length
    ? detail.review_runs
        .map(
          (run) => `<div class="summary-item">
            <strong>${escapeHtml(run.agentName)}</strong>
            <div class="badge-row">
              ${renderStatusBadge(formatLabel(run.resultStatus), run.resultStatus === "passed" ? "good" : "review")}
              <span class="subtle">${escapeHtml(run.model)} • ${escapeHtml(formatRelativeTime(run.createdAt))}</span>
            </div>
            <p style="margin-top:8px; line-height:1.45;">${escapeHtml(run.summary || "No summary")}</p>
          </div>`
        )
        .join("")
    : `<p class="subtle">No review runs recorded.</p>`;
  const history = detail.approval_actions.length
    ? detail.approval_actions
        .map(
          (item) => `<div class="history-item">
            <strong>${escapeHtml(formatLabel(item.action))}</strong>
            <p class="subtle">${escapeHtml(item.actedByName)} • ${escapeHtml(formatRelativeTime(item.createdAt))}</p>
            ${item.notes ? `<p style="margin-top:6px;">${escapeHtml(item.notes)}</p>` : ""}
          </div>`
        )
        .join("")
    : `<p class="subtle">No prior reviewer actions on this request.</p>`;

  return `<div class="review-flow">
    <div class="panel focus-panel">
      <div class="recommendation ${recommendation.className}">
        <div class="recommendation-label">Recommended action</div>
        <h2>${escapeHtml(recommendation.decision)}</h2>
        <p><strong>${escapeHtml(recommendation.shortReason)}</strong></p>
        <p>${escapeHtml(recommendation.explainer)}</p>
        <div class="badge-row" style="margin-top:14px;">
          ${renderStatusBadge(`Queue ${queuePosition}`, "neutral")}
          ${renderStatusBadge(risk.label, risk.className === "tone-high" ? "alert" : risk.className === "tone-mid" ? "review" : "good")}
          ${renderStatusBadge(formatLabel(detail.visibility_target), "neutral")}
          ${renderStatusBadge(formatLabel(detail.content_type), "neutral")}
        </div>
      </div>

      <div class="focus-grid" style="margin-top:16px;">
        <div class="focus-block">
          <h3>What is being submitted?</h3>
          <p class="content-copy">${escapeHtml(detail.raw_text || "No caption or summary provided.")}</p>
          <div class="content-meta">
            <span class="subtle">Submitter: ${escapeHtml(detail.submitter_name)}</span>
            <span class="subtle">${escapeHtml(detail.submitter_email)}</span>
            <span class="subtle">Submitted ${escapeHtml(formatRelativeTime(detail.created_at))}</span>
          </div>
          <div class="summary-list" style="margin-top:14px;">
            <div class="summary-item">
              <strong>Caption draft</strong>
              <p>${escapeHtml(detail.caption_draft || "No caption draft generated.")}</p>
            </div>
            <div class="summary-item">
              <strong>Media attached</strong>
              <pre>${escapeHtml(mediaSummary)}</pre>
            </div>
          </div>
        </div>
        <div class="focus-block">
          <h3>Why this recommendation?</h3>
          <div class="summary-list">
            <div class="summary-item">
              <strong>Routing</strong>
              <p>${escapeHtml(detail.routing_decision?.rationale || "No routing rationale recorded.")}</p>
            </div>
            <div class="summary-item">
              <strong>Approver</strong>
              <p>${escapeHtml(detail.approver_name)} (${escapeHtml(detail.approver_role)})</p>
            </div>
            <div class="summary-item">
              <strong>Current state</strong>
              <div class="badge-row" style="margin-top:8px;">
                ${renderStatusBadge(formatLabel(detail.submission_status), "review")}
                ${renderStatusBadge(formatLabel(detail.state), "neutral")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <details class="disclosure">
      <summary>Review signals and model context</summary>
      <div class="disclosure-body">
        <div class="summary-list">${reviewSignals}</div>
      </div>
    </details>

    <details class="disclosure">
      <summary>Action history</summary>
      <div class="disclosure-body">
        <div class="history-list">${history}</div>
      </div>
    </details>

    <div class="panel decision-panel">
      <div class="header-row">
        <div>
          <h3>Make the call</h3>
          <p class="subtle" style="margin-top:6px;">Default to the fastest correct decision. Only ask the submitter for more when they can fix the item.</p>
        </div>
        <div class="badge-row">
          ${renderStatusBadge("A approve", "good")}
          ${renderStatusBadge("C changes", "review")}
          ${renderStatusBadge("R reject", "alert")}
        </div>
      </div>

      <div class="decision-grid" id="decision-grid">
        <button class="decision-option approve ${recommendation.defaultAction === "approve" ? "active" : ""}" type="button" data-action="approve" onclick="selectAction('approve')">
          <strong>Approve and next</strong>
          <span class="subtle">Publish this through the normal flow and load the next queued item.</span>
        </button>
        <button class="decision-option revise ${recommendation.defaultAction === "request_changes" ? "active" : ""}" type="button" data-action="request_changes" onclick="selectAction('request_changes')">
          <strong>Send back for changes</strong>
          <span class="subtle">Require a short, actionable note for the submitter.</span>
        </button>
        <button class="decision-option reject ${recommendation.defaultAction === "reject" ? "active" : ""}" type="button" data-action="reject" onclick="selectAction('reject')">
          <strong>Reject submission</strong>
          <span class="subtle">Stop this item and record why it should not move forward.</span>
        </button>
      </div>

      <div class="decision-support">
        <div>
          <input id="actedByEmail" type="text" value="${escapeHtml(detail.approver_email)}" placeholder="Reviewer email" />
        </div>
        <p id="decision-copy" class="subtle decision-copy"></p>
        <div id="notes-wrap" class="hidden">
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
      <div class="decision-actions" style="margin-top:14px; justify-content:space-between;">
        <div class="decision-actions">
          <button class="button-primary" id="submit-action" onclick="submitDecision('${escapeHtml(detail.id)}')">Approve and next</button>
          <button class="button-secondary" id="skip-button" onclick="window.location.href='/'">Skip for now</button>
        </div>
        <p id="action-status" class="subtle"></p>
      </div>
    </div>
  </div>`;
}

async function renderHome(activeId) {
  const queueResponse = await fetchJson("/approvals/queue");
  const queue = queueResponse.items || [];
  const queueIds = queue.map((item) => item.id);
  const selectedId = activeId || queueIds[0] || null;
  const detail = selectedId ? await fetchJson(`/approval-requests/${selectedId}`) : null;
  const feedResponse = await fetchJson("/feed/internal");
  const feed = feedResponse.items || [];
  const failedEventsResponse = await fetchJson("/workflow-events?status=failed");
  const failedEvents = failedEventsResponse.items || [];
  const highConcern = queue.filter((item) => Number(item.risk_score || 0) >= 0.75).length;

  return layout(`
    <section class="hero">
      <div>
        <div class="eyebrow">Reviewer workspace</div>
        <h1>Moderate one item at a time.</h1>
        <p class="subtle" style="margin-top:10px; max-width:760px;">The job here is simple: understand the submission, trust the recommendation when it is routine, and leave a clear note only when the submitter needs to change something.</p>
      </div>
      ${renderStatusBadge(`${queue.length} waiting`, queue.length ? "review" : "good")}
    </section>

    <section class="topline">
      <div class="metric">
        <div class="metric-label">Queue size</div>
        <strong>${escapeHtml(String(queue.length))}</strong>
        <span class="subtle">Pending decisions right now</span>
      </div>
      <div class="metric">
        <div class="metric-label">High concern</div>
        <strong>${escapeHtml(String(highConcern))}</strong>
        <span class="subtle">Needs slower review</span>
      </div>
      <div class="metric">
        <div class="metric-label">Oldest item</div>
        <strong>${escapeHtml(queue[0] ? formatRelativeTime(queue[0].created_at) : "None")}</strong>
        <span class="subtle">How long the top item has waited</span>
      </div>
      <div class="metric">
        <div class="metric-label">Reviewer mode</div>
        <strong>Approve and move</strong>
        <span class="subtle">Use notes only when the submitter needs help</span>
      </div>
    </section>

    <section class="workspace">
      ${renderQueue(queue, selectedId)}
      ${renderFocus(detail, queueIds)}
    </section>

    <section style="margin-top:18px;">
      ${renderFooterPanels(feed, failedEvents)}
    </section>

    <script>
      const queueIds = ${JSON.stringify(queueIds)};
      let selectedAction = ${JSON.stringify(detail ? recommendationFor(detail).defaultAction : "approve")};

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

        if (action === 'approve') {
          submit.textContent = 'Approve and next';
          decisionCopy.textContent = 'This will publish the item and move straight to the next queued review.';
          notesWrap.classList.add('hidden');
          chips.classList.add('hidden');
          notes.value = '';
        } else if (action === 'request_changes') {
          submit.textContent = 'Send back with note';
          decisionCopy.textContent = 'This will return the item to the submitter. A clear note is required.';
          notesWrap.classList.remove('hidden');
          chips.classList.remove('hidden');
          notes.placeholder = 'Tell the submitter exactly what needs to change.';
        } else {
          submit.textContent = 'Reject submission';
          decisionCopy.textContent = 'This will stop the item here. Record a short reason for the audit trail.';
          notesWrap.classList.remove('hidden');
          chips.classList.remove('hidden');
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
