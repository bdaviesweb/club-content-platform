#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://clubcontent-api.davmn.net}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
TEAM_SLUG="${TEAM_SLUG:-u14-girls}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-comms@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-approval-publish-smoke-mobile-qa-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

API_BASE_URL="${API_BASE_URL}" \
CLUB_SLUG="${CLUB_SLUG}" \
TEAM_SLUG="${TEAM_SLUG}" \
SUBMITTER_EMAIL="${SUBMITTER_EMAIL}" \
REVIEWER_EMAIL="${REVIEWER_EMAIL}" \
TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" \
POLL_SECONDS="${POLL_SECONDS}" \
SMOKE_MARKER="${SMOKE_MARKER}" \
node <<'NODE'
const apiBaseUrl = process.env.API_BASE_URL.replace(/\/+$/, "");
const clubSlug = process.env.CLUB_SLUG;
const teamSlug = process.env.TEAM_SLUG;
const submitterEmail = process.env.SUBMITTER_EMAIL;
const reviewerEmail = process.env.REVIEWER_EMAIL;
const timeoutSeconds = Number(process.env.TIMEOUT_SECONDS || 300);
const pollSeconds = Number(process.env.POLL_SECONDS || 3);
const marker = process.env.SMOKE_MARKER;
const smokePrefixes = [
  "admin-review-smoke-",
  "approval-publish-smoke-",
  "approval-publish-smoke-mobile-qa-",
  "hermes-smoke-",
  "hermes-diagnostic-",
  "E2E smoke post",
  "Approval action smoke",
  "mobile-demo-post-"
];

const deadline = Date.now() + timeoutSeconds * 1000;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isSmokeRawText(value) {
  const rawText = String(value || "");
  return smokePrefixes.some((prefix) => rawText.startsWith(prefix));
}

function summarizeQueueItems(items = []) {
  return items.map((item) => ({
    id: item.id,
    submissionId: item.submission_id,
    rawText: item.raw_text
  }));
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
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
    throw new Error(`${options.method || "GET"} ${path} failed ${response.status}: ${text}`);
  }

  return payload;
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

console.log(`Checking API health: ${apiBaseUrl}`);
await request("/health");

const initialQueue = await request("/approvals/queue");
const initialQueueItems = initialQueue.items || [];
const staleSmokeItems = initialQueueItems.filter((item) => isSmokeRawText(item.raw_text));
if (staleSmokeItems.length) {
  throw new Error(
    `Pending smoke approvals already exist: ${JSON.stringify(summarizeQueueItems(staleSmokeItems))}. ` +
      "Clear them before running mobile_qa_public_api_smoke.sh."
  );
}

const initialQueueCount = initialQueueItems.length;
console.log(`initial_queue_count=${initialQueueCount}`);

console.log(`Creating mobile QA smoke submission: ${marker}`);
const created = await request("/submissions", {
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
  const queue = await request("/approvals/queue");
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
if (queueItem.latest_review_summary) {
  console.log(`latest_review_summary=${queueItem.latest_review_summary}`);
}

console.log("Approving mobile QA smoke submission...");
await request(`/approval-requests/${queueItem.id}/actions`, {
  method: "POST",
  body: JSON.stringify({
    action: "approve",
    actedByEmail: reviewerEmail,
    notes: "Mobile QA public API smoke."
  })
});

const publishedDetail = await waitFor("published submission", async (attempt) => {
  const detail = await request(`/submissions/${submissionId}`);
  if (detail.status === "published" && detail.publishedPost?.id) return detail;
  if (attempt === 1 || attempt % 5 === 0) {
    console.log(`Waiting for publish. attempt=${attempt} status=${detail.status || "unknown"}`);
  }
  return null;
});

const finalQueue = await request("/approvals/queue");
const finalQueueItems = finalQueue.items || [];
const stillPending = finalQueueItems.some((item) => item.submission_id === submissionId);
if (stillPending) {
  throw new Error(`Submission ${submissionId} is still present in the review queue`);
}

if (finalQueueItems.length > initialQueueCount) {
  throw new Error(
    `Approval queue grew during smoke: initial=${initialQueueCount} final=${finalQueueItems.length} ` +
      `remaining=${JSON.stringify(summarizeQueueItems(finalQueueItems))}`
  );
}

console.log("Mobile QA public API smoke passed.");
console.log(`status=${publishedDetail.status}`);
console.log(`destination=${publishedDetail.publishedPost.destinationName}`);
console.log(`published_at=${publishedDetail.publishedPost.publishedAt}`);
console.log(`final_queue_count=${finalQueueItems.length}`);
NODE
