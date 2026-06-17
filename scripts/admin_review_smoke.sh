#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://clubcontent-api.davmn.net}"
ADMIN_BASE_URL="${ADMIN_BASE_URL:-http://127.0.0.1:3011}"
ADMIN_PORT="${ADMIN_PORT:-3011}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
TEAM_SLUG="${TEAM_SLUG:-u14-girls}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-admin-review-smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

API_BASE_URL="${API_BASE_URL}" \
ADMIN_BASE_URL="${ADMIN_BASE_URL}" \
ADMIN_PORT="${ADMIN_PORT}" \
CLUB_SLUG="${CLUB_SLUG}" \
TEAM_SLUG="${TEAM_SLUG}" \
SUBMITTER_EMAIL="${SUBMITTER_EMAIL}" \
REVIEWER_EMAIL="${REVIEWER_EMAIL}" \
TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" \
POLL_SECONDS="${POLL_SECONDS}" \
SMOKE_MARKER="${SMOKE_MARKER}" \
node <<'NODE'
const { spawn } = require("node:child_process");

const apiBaseUrl = process.env.API_BASE_URL.replace(/\/+$/, "");
const adminBaseUrl = process.env.ADMIN_BASE_URL.replace(/\/+$/, "");
const adminPort = process.env.ADMIN_PORT;
const clubSlug = process.env.CLUB_SLUG;
const teamSlug = process.env.TEAM_SLUG;
const submitterEmail = process.env.SUBMITTER_EMAIL;
const reviewerEmail = process.env.REVIEWER_EMAIL;
const timeoutSeconds = Number(process.env.TIMEOUT_SECONDS || 300);
const pollSeconds = Number(process.env.POLL_SECONDS || 3);
const marker = process.env.SMOKE_MARKER;
const deadline = Date.now() + timeoutSeconds * 1000;
let adminProcess = null;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function authHeaders() {
  const user = process.env.ADMIN_BASIC_AUTH_USER || "";
  const password = process.env.ADMIN_BASIC_AUTH_PASSWORD || "";
  if (!user || !password) {
    return {};
  }

  return {
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
  };
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${baseUrl}${path} failed ${response.status}: ${text}`);
  }

  return payload;
}

async function requestAdminHtml(path) {
  const response = await fetch(`${adminBaseUrl}${path}`, {
    headers: authHeaders()
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${adminBaseUrl}${path} failed ${response.status}: ${text}`);
  }
  return text;
}

async function requestAdminJson(path, options = {}) {
  return requestJson(adminBaseUrl, path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
}

async function waitFor(description, callback) {
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const result = await callback(attempt);
    if (result) return result;
    await sleep(pollSeconds * 1000);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function startAdminServer() {
  const child = spawn(process.execPath, ["apps/admin-web/server.js"], {
    env: {
      ...process.env,
      API_BASE_URL: apiBaseUrl,
      PORT: adminPort
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[admin] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[admin] ${chunk}`));
  adminProcess = child;
  return child;
}

function killAdminNow() {
  if (adminProcess && adminProcess.exitCode === null && adminProcess.signalCode === null) {
    adminProcess.kill("SIGTERM");
  }
}

async function stopAdmin() {
  if (!adminProcess || adminProcess.exitCode !== null || adminProcess.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => {
    adminProcess.once("exit", () => resolve(true));
  });
  adminProcess.kill("SIGTERM");
  const stopped = await Promise.race([exited, sleep(2000).then(() => false)]);

  if (!stopped && adminProcess.exitCode === null && adminProcess.signalCode === null) {
    adminProcess.kill("SIGKILL");
    await Promise.race([exited, sleep(1000)]);
  }
}

async function main() {
  console.log(`Checking API health: ${apiBaseUrl}`);
  await requestJson(apiBaseUrl, "/health");

  console.log(`Starting admin web on ${adminBaseUrl}`);
  const admin = startAdminServer();
  let adminStopped = false;
  admin.on("exit", (code, signal) => {
    adminStopped = true;
    if (code && code !== 0) {
      console.error(`Admin web exited early: code=${code} signal=${signal || ""}`);
    }
  });

  process.on("exit", killAdminNow);
  process.on("SIGINT", () => {
    killAdminNow();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    killAdminNow();
    process.exit(143);
  });

  await waitFor("admin web to respond", async () => {
    if (adminStopped) {
      throw new Error("Admin web stopped before it became ready");
    }
    try {
      const html = await requestAdminHtml("/");
      return html.includes("Reviewer workspace");
    } catch {
      return false;
    }
  });

  console.log(`Creating admin review smoke submission: ${marker}`);
  const created = await requestJson(apiBaseUrl, "/submissions", {
    method: "POST",
    body: JSON.stringify({
      clubSlug,
      teamSlug,
      submitterEmail,
      contentType: "photo",
      visibilityTarget: "internal",
      rawText: marker,
      media: []
    })
  });

  const submissionId = created.submission?.id || created.id;
  if (!submissionId) {
    throw new Error("Submission create response did not include an id");
  }
  console.log(`submission_id=${submissionId}`);

  const queueItem = await waitFor("approval queue item", async (attempt) => {
    const queue = await requestJson(apiBaseUrl, "/approvals/queue");
    const item = (queue.items || []).find(
      (candidate) => candidate.submission_id === submissionId || candidate.raw_text === marker
    );

    if (item?.id) return item;
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`Waiting for review. attempt=${attempt}`);
    }
    return null;
  });

  console.log(`approval_request_id=${queueItem.id}`);
  const quickReviewPath = `/quick-review?approvalRequestId=${encodeURIComponent(queueItem.id)}`;
  const html = await requestAdminHtml(quickReviewPath);
  if (!html.includes("Quick review") || !html.includes(marker)) {
    throw new Error(`Admin quick review page did not render smoke item at ${quickReviewPath}`);
  }
  console.log(`admin_quick_review_url=${adminBaseUrl}${quickReviewPath}`);

  console.log("Approving through admin web UI proxy...");
  await requestAdminJson(`/ui/actions/${encodeURIComponent(queueItem.id)}`, {
    method: "POST",
    body: JSON.stringify({
      action: "approve",
      actedByEmail: reviewerEmail,
      notes: "Admin review smoke."
    })
  });

  const publishedDetail = await waitFor("published submission", async (attempt) => {
    const detail = await requestAdminJson(`/ui/submissions/${encodeURIComponent(submissionId)}`);
    if (detail.status === "published" && detail.publishedPost?.id) return detail;
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`Waiting for publish. attempt=${attempt} status=${detail.status || "unknown"}`);
    }
    return null;
  });

  const finalQueue = await requestJson(apiBaseUrl, "/approvals/queue");
  const stillPending = (finalQueue.items || []).some((item) => item.submission_id === submissionId);
  if (stillPending) {
    throw new Error(`Submission ${submissionId} is still present in the review queue`);
  }

  console.log("Admin review smoke passed.");
  console.log(`status=${publishedDetail.status}`);
  console.log(`published_post_id=${publishedDetail.publishedPost.id}`);
  console.log(`destination=${publishedDetail.publishedPost.destinationName}`);
  console.log(`published_at=${publishedDetail.publishedPost.publishedAt}`);
  console.log(`final_queue_count=${(finalQueue.items || []).length}`);

  await stopAdmin();
}

main().catch((error) => {
  console.error(error);
  killAdminNow();
  process.exit(1);
});
NODE
