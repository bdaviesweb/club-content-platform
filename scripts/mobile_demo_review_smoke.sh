#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://clubcontent-api.davmn.net}"
EXPO_URL="${EXPO_URL:-exp://10.0.0.133:8082}"
METRO_STATUS_URL="${METRO_STATUS_URL:-http://localhost:8082/status}"
SIMULATOR_DEVICE="${SIMULATOR_DEVICE:-booted}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
ALLOW_NONEMPTY_QUEUE="${ALLOW_NONEMPTY_QUEUE:-0}"

API_BASE_URL="${API_BASE_URL}" \
EXPO_URL="${EXPO_URL}" \
METRO_STATUS_URL="${METRO_STATUS_URL}" \
SIMULATOR_DEVICE="${SIMULATOR_DEVICE}" \
CLUB_SLUG="${CLUB_SLUG}" \
SUBMITTER_EMAIL="${SUBMITTER_EMAIL}" \
TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" \
POLL_SECONDS="${POLL_SECONDS}" \
ALLOW_NONEMPTY_QUEUE="${ALLOW_NONEMPTY_QUEUE}" \
node <<'NODE'
const { execFileSync } = require("node:child_process");

const apiBaseUrl = process.env.API_BASE_URL.replace(/\/+$/, "");
const expoUrl = process.env.EXPO_URL.replace(/\/+$/, "");
const metroStatusUrl = process.env.METRO_STATUS_URL;
const simulatorDevice = process.env.SIMULATOR_DEVICE;
const clubSlug = process.env.CLUB_SLUG;
const submitterEmail = process.env.SUBMITTER_EMAIL;
const timeoutSeconds = Number(process.env.TIMEOUT_SECONDS || 300);
const pollSeconds = Number(process.env.POLL_SECONDS || 3);
const allowNonemptyQueue = process.env.ALLOW_NONEMPTY_QUEUE === "1";
const deadline = Date.now() + timeoutSeconds * 1000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function actionUrl(action) {
  return `${expoUrl}${expoUrl.includes("?") ? "&" : "?"}demoAction=${encodeURIComponent(action)}`;
}

function openSimulatorUrl(url) {
  console.log(`Opening simulator URL: ${url}`);
  execFileSync("xcrun", ["simctl", "openurl", simulatorDevice, url], {
    stdio: "inherit"
  });
}

async function requestJson(path, options = {}) {
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

async function checkMetro() {
  const response = await fetch(metroStatusUrl);
  const text = await response.text();
  if (!response.ok || !text.includes("packager-status:running")) {
    throw new Error(`Metro is not ready at ${metroStatusUrl}: ${response.status} ${text}`);
  }
}

async function listSubmitterSubmissions() {
  const query = new URLSearchParams({
    submitterEmail,
    clubSlug,
    limit: "12"
  });
  return requestJson(`/submissions?${query.toString()}`);
}

async function main() {
  console.log(`Checking API health: ${apiBaseUrl}`);
  await requestJson("/health");

  console.log(`Checking Metro: ${metroStatusUrl}`);
  await checkMetro();

  const initialSubmissions = await listSubmitterSubmissions();
  const initialSubmissionIds = new Set(
    (initialSubmissions.items || []).map((submission) => submission.id)
  );

  const initialQueue = await requestJson("/approvals/queue");
  if ((initialQueue.items || []).length && !allowNonemptyQueue) {
    throw new Error(
      `Review queue has ${initialQueue.items.length} pending item(s). ` +
        "Run cleanup first or set ALLOW_NONEMPTY_QUEUE=1 if approving the first queue item is intentional."
    );
  }

  console.log(`Initial queue count=${(initialQueue.items || []).length}`);
  openSimulatorUrl(actionUrl("post"));

  const createdSubmission = await waitFor("new demo submission from mobile app", async (attempt) => {
    const payload = await listSubmitterSubmissions();
    const item = (payload.items || []).find((candidate) => {
      return (
        candidate.raw_text?.startsWith("mobile-demo-post-") &&
        !initialSubmissionIds.has(candidate.id)
      );
    });

    if (item?.id) return item;
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`Waiting for mobile-created demo submission. attempt=${attempt}`);
    }
    return null;
  });

  console.log(`submission_id=${createdSubmission.id}`);
  console.log(`raw_text=${createdSubmission.raw_text}`);

  const queueItem = await waitFor("created submission to reach review queue", async (attempt) => {
    const queue = await requestJson("/approvals/queue");
    const item = (queue.items || []).find(
      (candidate) => candidate.submission_id === createdSubmission.id
    );

    if (item?.id) return item;
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`Waiting for review queue item. attempt=${attempt}`);
    }
    return null;
  });

  console.log(`approval_request_id=${queueItem.id}`);
  if (queueItem.latest_review_summary) {
    console.log(`latest_review_summary=${queueItem.latest_review_summary}`);
  }

  openSimulatorUrl(actionUrl("approveFirstReview"));

  const publishedDetail = await waitFor("approved submission to publish", async (attempt) => {
    const detail = await requestJson(`/submissions/${createdSubmission.id}`);
    if (detail.status === "published" && detail.publishedPost?.id) return detail;
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`Waiting for publish. attempt=${attempt} status=${detail.status || "unknown"}`);
    }
    return null;
  });

  const finalQueue = await requestJson("/approvals/queue");
  const stillPending = (finalQueue.items || []).some(
    (item) => item.submission_id === createdSubmission.id
  );
  if (stillPending) {
    throw new Error(`Submission ${createdSubmission.id} is still present in the review queue`);
  }

  console.log("Mobile demo review smoke passed.");
  console.log(`status=${publishedDetail.status}`);
  console.log(`published_post_id=${publishedDetail.publishedPost.id}`);
  console.log(`destination=${publishedDetail.publishedPost.destinationName}`);
  console.log(`published_at=${publishedDetail.publishedPost.publishedAt}`);
  console.log(`final_queue_count=${(finalQueue.items || []).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
