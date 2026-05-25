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

function layout(content, title = "Club Content Admin") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f0ece2;
        --ink: #1c2b25;
        --panel: rgba(255, 252, 245, 0.92);
        --accent: #0f6a4b;
        --accent-2: #b95c2e;
        --border: #d7cfbc;
        --muted: #6d746e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 106, 75, 0.14), transparent 28%),
          radial-gradient(circle at top right, rgba(185, 92, 46, 0.14), transparent 24%),
          linear-gradient(180deg, #f8f3e8 0%, #eee5cf 100%);
      }
      main {
        max-width: 1200px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 24px;
      }
      h1, h2, h3 { margin: 0; }
      h1 { font-size: 2.4rem; }
      .subtle { color: var(--muted); }
      .grid {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 20px;
        align-items: start;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 12px 30px rgba(28, 43, 37, 0.08);
        backdrop-filter: blur(8px);
      }
      .queue-list {
        display: grid;
        gap: 12px;
      }
      .queue-card, .feed-card {
        display: block;
        text-decoration: none;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.58);
      }
      .queue-card.active {
        border-color: var(--accent);
        box-shadow: inset 0 0 0 1px var(--accent);
      }
      .queue-card:hover {
        border-color: rgba(15, 106, 75, 0.45);
      }
      .pill {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.86rem;
        background: rgba(15, 106, 75, 0.12);
        color: var(--accent);
      }
      .pill.status-review { background: rgba(154, 95, 19, 0.14); color: #9a5f13; }
      .pill.status-approved { background: rgba(15, 106, 75, 0.12); color: var(--accent); }
      .pill.status-rejected { background: rgba(143, 53, 45, 0.14); color: #8f352d; }
      .pill.status-revision { background: rgba(185, 92, 46, 0.14); color: var(--accent-2); }
      .pill.status-neutral { background: rgba(109, 116, 110, 0.14); color: var(--muted); }
      .risk-high { color: #9f2f28; background: rgba(159, 47, 40, 0.12); }
      .risk-mid { color: #9a5f13; background: rgba(154, 95, 19, 0.12); }
      .summary-row,
      .meta-row,
      .key-facts,
      .shortcut-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
      }
      .summary-row { margin-top: 14px; }
      .meta-row { margin-top: 8px; }
      .shortcut-row { margin-top: 10px; }
      .summary-card {
        min-width: 110px;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.58);
      }
      .summary-card strong,
      .mini-label {
        display: block;
      }
      .mini-label {
        margin-bottom: 4px;
        font-size: 0.8rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .queue-preview {
        margin-top: 10px;
        line-height: 1.4;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 18px;
      }
      .detail-block {
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.54);
      }
      .detail-block.wide {
        grid-column: 1 / -1;
      }
      .detail-block.priority {
        border-color: rgba(185, 92, 46, 0.35);
        background: rgba(255, 248, 240, 0.84);
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        font-family: "SFMono-Regular", Menlo, monospace;
        font-size: 0.9rem;
      }
      form.actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      input[type="text"] {
        width: 100%;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid var(--border);
        font: inherit;
        background: rgba(255, 255, 255, 0.8);
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
        opacity: 0.6;
        cursor: wait;
      }
      button.approve { background: var(--accent); color: white; }
      button.reject { background: #8f352d; color: white; }
      button.revise { background: var(--accent-2); color: white; }
      button.note-chip {
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.7);
      }
      .sticky-actions {
        position: sticky;
        bottom: 14px;
        background: rgba(255, 252, 245, 0.96);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 14px;
        box-shadow: 0 12px 24px rgba(28, 43, 37, 0.1);
      }
      .decision-hint {
        margin-top: 12px;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid rgba(185, 92, 46, 0.25);
        background: rgba(185, 92, 46, 0.08);
      }
      .decision-hint ul {
        margin: 8px 0 0 18px;
        padding: 0;
      }
      .feed-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      .section-spacer { margin-top: 26px; }
      @media (max-width: 900px) {
        .grid { grid-template-columns: 1fr; }
        .detail-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>${content}</main>
  </body>
</html>`;
}

function formatLabel(value) {
  return String(value ?? "n/a")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatRelativeTime(value) {
  if (!value) {
    return "Unknown age";
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

function statusPill(value, type = "status") {
  const normalized = String(value ?? "").toLowerCase();
  let className = "pill status-neutral";

  if (
    ["needs_human_review", "screening", "pending", "flagged", "blocked", "error"].includes(
      normalized
    )
  ) {
    className = "pill status-review";
  } else if (["approved", "approved_internal", "approved_external", "passed"].includes(normalized)) {
    className = "pill status-approved";
  } else if (["rejected", "reject"].includes(normalized)) {
    className = "pill status-rejected";
  } else if (["request_changes", "changes_requested", "needs_metadata"].includes(normalized)) {
    className = "pill status-revision";
  }

  const prefix = type === "action" ? "Decision" : "Status";
  return `<span class="${className}">${escapeHtml(`${prefix}: ${formatLabel(value)}`)}</span>`;
}

function riskPill(riskScore) {
  const score = Number(riskScore || 0);
  let className = "pill";
  let label = `Risk ${score.toFixed(2)}`;
  if (score >= 0.75) {
    className += " risk-high";
    label = `High ${score.toFixed(2)}`;
  } else if (score >= 0.35) {
    className += " risk-mid";
    label = `Medium ${score.toFixed(2)}`;
  }
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

function summarizeQueue(queue) {
  const highRisk = queue.filter((item) => Number(item.risk_score || 0) >= 0.75).length;
  const mediumRisk = queue.filter((item) => {
    const score = Number(item.risk_score || 0);
    return score >= 0.35 && score < 0.75;
  }).length;
  const oldestCreatedAt = queue[0]?.created_at;

  return `<div class="summary-row">
    <div class="summary-card">
      <span class="mini-label">Pending</span>
      <strong>${escapeHtml(String(queue.length))}</strong>
    </div>
    <div class="summary-card">
      <span class="mini-label">High Risk</span>
      <strong>${escapeHtml(String(highRisk))}</strong>
    </div>
    <div class="summary-card">
      <span class="mini-label">Medium Risk</span>
      <strong>${escapeHtml(String(mediumRisk))}</strong>
    </div>
    <div class="summary-card">
      <span class="mini-label">Oldest Waiting</span>
      <strong>${escapeHtml(oldestCreatedAt ? formatRelativeTime(oldestCreatedAt) : "None")}</strong>
    </div>
  </div>`;
}

function renderQueue(queue, activeId) {
  if (!queue.length) {
    return `<div class="panel"><p class="subtle">No pending approvals.</p></div>`;
  }

  const cards = queue
    .map((item) => {
      const isActive = item.id === activeId ? " active" : "";
      const preview = item.latest_review_summary || item.raw_text || "No review summary yet.";
      return `<a class="queue-card${isActive}" href="/?approvalRequestId=${encodeURIComponent(item.id)}">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <strong>${escapeHtml(item.approver_name)}</strong>
          ${riskPill(item.risk_score)}
        </div>
        <div class="meta-row">
          ${statusPill(item.submission_status)}
          <span class="subtle">${escapeHtml(formatRelativeTime(item.created_at))}</span>
        </div>
        <div class="subtle" style="margin-top:8px;">Submission ${escapeHtml(item.submission_id)}</div>
        <div class="queue-preview">${escapeHtml(preview)}</div>
      </a>`;
    })
    .join("");

  return `<div class="panel">
    <h2>Approval Queue</h2>
    <p class="subtle">Pending items awaiting moderation decisions. Oldest requests are shown first.</p>
    ${summarizeQueue(queue)}
    <div class="queue-list">${cards}</div>
  </div>`;
}

function renderDetail(detail) {
  if (!detail) {
    return `<div class="panel">
      <h2>Review Detail</h2>
      <p class="subtle">Select a queue item to inspect AI findings and act on it.</p>
    </div>`;
  }

  const blockedRuns = detail.review_runs.filter((run) =>
    ["blocked", "flagged", "error"].includes(String(run.resultStatus || "").toLowerCase())
  );
  const latestReviewSummary = detail.review_runs[0]?.summary || "";
  const latestAction = detail.approval_actions[0] || null;
  const routingDecision = detail.routing_decision || {};
  const routingSummary = Object.entries(routingDecision)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `<li><strong>${escapeHtml(formatLabel(key))}:</strong> ${escapeHtml(typeof value === "object" ? JSON.stringify(value) : String(value))}</li>`)
    .join("");
  const decisionHints = [];

  if (Number(detail.risk_score || 0) >= 0.75) {
    decisionHints.push("High-risk submission: confirm policy fit before approving.");
  }
  if (blockedRuns.length) {
    decisionHints.push(`${blockedRuns.length} review run(s) returned flagged, blocked, or error states.`);
  }
  if (detail.submission_status === "needs_metadata") {
    decisionHints.push("Submission already needs metadata, so request changes may be the fastest resolution.");
  }

  const reviewRuns = detail.review_runs.length
    ? detail.review_runs
        .map(
          (run) => `<div class="detail-block">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
              <strong>${escapeHtml(run.agentName)}</strong>
              ${statusPill(run.resultStatus)}
            </div>
            <div class="subtle" style="margin-top:6px;">${escapeHtml(run.model)} • confidence ${escapeHtml(run.confidence)} • ${escapeHtml(formatRelativeTime(run.createdAt))}</div>
            <p>${escapeHtml(run.summary || "")}</p>
          </div>`
        )
        .join("")
    : `<div class="detail-block"><p class="subtle">No review runs recorded.</p></div>`;

  const media = detail.media.length
    ? `<ul>${detail.media
        .map(
          (item) =>
            `<li><code>${escapeHtml(item.objectKey)}</code> (${escapeHtml(item.mediaType)})</li>`
        )
        .join("")}</ul>`
    : `<p class="subtle">No media metadata attached.</p>`;

  const actions = detail.approval_actions.length
    ? detail.approval_actions
        .map(
          (item) =>
            `<li>${escapeHtml(item.actedByName)}: ${escapeHtml(formatLabel(item.action))} • ${escapeHtml(formatRelativeTime(item.createdAt))}${item.notes ? ` — ${escapeHtml(item.notes)}` : ""}</li>`
        )
        .join("")
    : `<li class="subtle">No actions recorded yet.</li>`;

  return `<div class="panel">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:start;">
      <div>
        <h2>Review Detail</h2>
        <p class="subtle">Submission ${escapeHtml(detail.submission_id)} from ${escapeHtml(detail.submitter_name)}</p>
      </div>
      ${riskPill(detail.risk_score)}
    </div>
    <div class="summary-row">
      <div class="summary-card">
        <span class="mini-label">Submission</span>
        <strong>${escapeHtml(formatLabel(detail.submission_status))}</strong>
      </div>
      <div class="summary-card">
        <span class="mini-label">Approval</span>
        <strong>${escapeHtml(formatLabel(detail.state))}</strong>
      </div>
      <div class="summary-card">
        <span class="mini-label">Queue Age</span>
        <strong>${escapeHtml(formatRelativeTime(detail.created_at))}</strong>
      </div>
      <div class="summary-card">
        <span class="mini-label">Review Flags</span>
        <strong>${escapeHtml(String(blockedRuns.length))}</strong>
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-block">
        <h3>Submission</h3>
        <div class="key-facts">
          ${statusPill(detail.submission_status)}
          ${statusPill(detail.state)}
        </div>
        <p><strong>Type:</strong> ${escapeHtml(formatLabel(detail.content_type))}</p>
        <p><strong>Visibility:</strong> ${escapeHtml(formatLabel(detail.visibility_target))}</p>
        <p><strong>Submitter:</strong> ${escapeHtml(detail.submitter_name)} (${escapeHtml(detail.submitter_email)})</p>
      </div>
      <div class="detail-block">
        <h3>Routing</h3>
        <p><strong>Approver:</strong> ${escapeHtml(detail.approver_name)} (${escapeHtml(detail.approver_role)})</p>
        ${
          routingSummary
            ? `<ul>${routingSummary}</ul>`
            : `<p class="subtle">No routing summary available.</p>`
        }
        <pre>${escapeHtml(JSON.stringify(detail.routing_decision || {}, null, 2))}</pre>
      </div>
      <div class="detail-block priority wide">
        <h3>Decision Context</h3>
        <p>${escapeHtml(latestReviewSummary || "No reviewer summary recorded.")}</p>
        ${
          latestAction
            ? `<p class="subtle">Latest action: ${escapeHtml(formatLabel(latestAction.action))} by ${escapeHtml(latestAction.actedByName)} ${escapeHtml(formatRelativeTime(latestAction.createdAt))}.</p>`
            : `<p class="subtle">No prior reviewer actions on this request.</p>`
        }
        ${
          decisionHints.length
            ? `<div class="decision-hint"><strong>Reviewer focus</strong><ul>${decisionHints
                .map((hint) => `<li>${escapeHtml(hint)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
      </div>
      <div class="detail-block wide">
        <h3>Caption / Notes</h3>
        <pre>${escapeHtml(detail.raw_text || "No text provided.")}</pre>
      </div>
      <div class="detail-block wide">
        <h3>AI Caption Draft</h3>
        <pre>${escapeHtml(detail.caption_draft || "No caption draft generated yet.")}</pre>
      </div>
      <div class="detail-block">
        <h3>Media</h3>
        ${media}
      </div>
      <div class="detail-block">
        <h3>Action Log</h3>
        <ul>${actions}</ul>
      </div>
      <div class="detail-block wide">
        <h3>Review Runs</h3>
        <div class="detail-grid">${reviewRuns}</div>
      </div>
    </div>
    <div class="section-spacer sticky-actions">
      <h3>Decision</h3>
      <p class="subtle">Use <strong>A</strong> to approve, <strong>R</strong> to reject, and <strong>C</strong> to request changes.</p>
      <input id="actedByEmail" type="text" value="${escapeHtml(detail.approver_email)}" />
      <div style="height:10px;"></div>
      <input id="notes" type="text" placeholder="Notes required for reject or request changes" />
      <div class="shortcut-row">
        <button class="note-chip" type="button" onclick="applyNote('Missing context or metadata.')">Missing metadata</button>
        <button class="note-chip" type="button" onclick="applyNote('Needs caption cleanup before approval.')">Caption cleanup</button>
        <button class="note-chip" type="button" onclick="applyNote('Risk or policy concern needs revision.')">Policy concern</button>
      </div>
      <form class="actions" onsubmit="return false;">
        <button class="approve" onclick="takeAction('${escapeHtml(detail.id)}', 'approve')">Approve</button>
        <button class="reject" onclick="takeAction('${escapeHtml(detail.id)}', 'reject')">Reject</button>
        <button class="revise" onclick="takeAction('${escapeHtml(detail.id)}', 'request_changes')">Request Changes</button>
      </form>
      <p id="action-status" class="subtle"></p>
    </div>
  </div>`;
}

function renderFeed(feed) {
  const cards = feed.length
    ? feed
        .map(
          (item) => `<div class="feed-card">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
              <strong>${escapeHtml(item.destination_name)}</strong>
              <span class="pill">${escapeHtml(item.content_type)}</span>
            </div>
            <p>${escapeHtml(item.caption_draft || item.raw_text || "No caption.")}</p>
            <div class="subtle">Submission ${escapeHtml(item.submission_id)}</div>
          </div>`
        )
        .join("")
    : `<p class="subtle">Nothing has been published yet.</p>`;

  return `<div class="panel section-spacer">
    <h2>Internal Feed</h2>
    <p class="subtle">Recently published items from the current workflow.</p>
    <div class="feed-grid">${cards}</div>
  </div>`;
}

function renderWorkflowEvents(events) {
  const rows = events.length
    ? events
        .map(
          (item) => `<div class="feed-card">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
              <strong>${escapeHtml(item.event_name)}</strong>
              <span class="pill">${escapeHtml(item.submission_status || "n/a")}</span>
            </div>
            <p><code>${escapeHtml(item.id)}</code></p>
            <p class="subtle">Submission ${escapeHtml(item.submission_id || "none")}</p>
            <p>${escapeHtml(item.processing_error || "No error recorded.")}</p>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <button class="approve" onclick="retryEvent('${escapeHtml(item.id)}')">Retry Event</button>
            </div>
          </div>`
        )
        .join("")
    : `<p class="subtle">No failed workflow events.</p>`;

  return `<div class="panel section-spacer">
    <h2>Workflow Recovery</h2>
    <p class="subtle">Failed events can be reset and retried through the normal worker loop.</p>
    <div class="feed-grid">${rows}</div>
    <p id="event-status" class="subtle"></p>
  </div>`;
}

async function renderHome(activeId) {
  const queueResponse = await fetchJson("/approvals/queue");
  const queue = queueResponse.items || [];
  const selectedId = activeId || (queue[0] ? queue[0].id : null);
  const detail = selectedId
    ? await fetchJson(`/approval-requests/${selectedId}`)
    : null;
  const feedResponse = await fetchJson("/feed/internal");
  const feed = feedResponse.items || [];
  const failedEventsResponse = await fetchJson("/workflow-events?status=failed");
  const failedEvents = failedEventsResponse.items || [];

  return layout(`
    <header>
      <div>
        <h1>Club Content Approval Console</h1>
        <p class="subtle">Moderation queue, review detail, and internal publishing status.</p>
      </div>
      <span class="pill">${queue.length} pending</span>
    </header>
    <div class="grid">
      ${renderQueue(queue, selectedId)}
      ${renderDetail(detail)}
    </div>
    ${renderFeed(feed)}
    ${renderWorkflowEvents(failedEvents)}
    <script>
      function setActionButtonsDisabled(disabled) {
        document.querySelectorAll(".actions button").forEach((button) => {
          button.disabled = disabled;
        });
      }

      function applyNote(note) {
        const input = document.getElementById("notes");
        input.value = note;
        input.focus();
      }

      async function takeAction(approvalRequestId, action) {
        const actedByEmail = document.getElementById("actedByEmail").value;
        const notes = document.getElementById("notes").value.trim();
        const status = document.getElementById("action-status");
        if (!actedByEmail.trim()) {
          status.textContent = "Reviewer email is required.";
          return;
        }
        if (["reject", "request_changes"].includes(action) && !notes) {
          status.textContent = "Add a note before rejecting or requesting changes.";
          document.getElementById("notes").focus();
          return;
        }
        status.textContent = "Saving...";
        setActionButtonsDisabled(true);
        const response = await fetch("/ui/actions/" + approvalRequestId, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, actedByEmail, notes })
        });
        const payload = await response.json();
        if (!response.ok) {
          status.textContent = payload.error || "Action failed";
          setActionButtonsDisabled(false);
          return;
        }
        status.textContent = "Action saved. Reloading...";
        window.location.href = "/";
      }

      async function retryEvent(eventId) {
        const status = document.getElementById("event-status");
        status.textContent = "Retrying event...";
        const response = await fetch("/ui/workflow-events/" + eventId + "/retry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actorEmail: "comms@demo-club.local",
            notes: "Retry requested from admin console."
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          status.textContent = payload.error || "Retry failed";
          return;
        }
        status.textContent = "Event reset. Reloading...";
        window.location.href = "/";
      }

      document.addEventListener("keydown", (event) => {
        const target = event.target;
        const tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
        if (tagName === "input" || tagName === "textarea") {
          return;
        }
        if (event.key === "a" || event.key === "A") {
          const button = document.querySelector("button.approve");
          if (button) button.click();
        }
        if (event.key === "r" || event.key === "R") {
          const button = document.querySelector("button.reject");
          if (button) button.click();
        }
        if (event.key === "c" || event.key === "C") {
          const button = document.querySelector("button.revise");
          if (button) button.click();
        }
      });
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

    if (
      req.method === "POST" &&
      /^\/ui\/actions\/[^/]+$/.test(url.pathname)
    ) {
      const approvalRequestId = url.pathname.split("/")[3];
      const body = await readJson(req);
      const payload = await fetchJson(
        `/approval-requests/${approvalRequestId}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (
      req.method === "POST" &&
      /^\/ui\/workflow-events\/[^/]+\/retry$/.test(url.pathname)
    ) {
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
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error.message || "Internal server error");
  }
});

server.listen(port, () => {
  console.log(`admin-web listening on ${port}`);
});
