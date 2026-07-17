#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://clubcontent-api.davmn.net}"
ORGANIZATION_SLUG="${ORGANIZATION_SLUG:-demo-sports-org}"
CLUB_SLUG="${CLUB_SLUG:-demo-soccer-club}"
TEAM_SLUG="${TEAM_SLUG:-u14-girls}"
SUBMITTER_EMAIL="${SUBMITTER_EMAIL:-coach@demo-club.local}"
REVIEWER_EMAIL="${REVIEWER_EMAIL:-comms@demo-club.local}"
ORGANIZATION_ADMIN_EMAIL="${ORGANIZATION_ADMIN_EMAIL:-org-admin@demo-club.local}"
CLUB_ADMIN_EMAIL="${CLUB_ADMIN_EMAIL:-comms@demo-club.local}"
MANUAL_COUNT="${MANUAL_COUNT:-3}"
AUTO_COUNT="${AUTO_COUNT:-3}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-3}"
SMOKE_MARKER="${SMOKE_MARKER:-batch-sim-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}}"

API_BASE_URL="${API_BASE_URL}" \
ORGANIZATION_SLUG="${ORGANIZATION_SLUG}" \
CLUB_SLUG="${CLUB_SLUG}" \
TEAM_SLUG="${TEAM_SLUG}" \
SUBMITTER_EMAIL="${SUBMITTER_EMAIL}" \
REVIEWER_EMAIL="${REVIEWER_EMAIL}" \
ORGANIZATION_ADMIN_EMAIL="${ORGANIZATION_ADMIN_EMAIL}" \
CLUB_ADMIN_EMAIL="${CLUB_ADMIN_EMAIL}" \
MANUAL_COUNT="${MANUAL_COUNT}" \
AUTO_COUNT="${AUTO_COUNT}" \
TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" \
POLL_SECONDS="${POLL_SECONDS}" \
SMOKE_MARKER="${SMOKE_MARKER}" \
node <<'NODE'
const apiBaseUrl = process.env.API_BASE_URL.replace(/\/+$/, "");
const organizationSlug = process.env.ORGANIZATION_SLUG;
const clubSlug = process.env.CLUB_SLUG;
const teamSlug = process.env.TEAM_SLUG;
const submitterEmail = process.env.SUBMITTER_EMAIL;
const reviewerEmail = process.env.REVIEWER_EMAIL;
const organizationAdminEmail = process.env.ORGANIZATION_ADMIN_EMAIL;
const clubAdminEmail = process.env.CLUB_ADMIN_EMAIL;
const manualCount = Number(process.env.MANUAL_COUNT || 3);
const autoCount = Number(process.env.AUTO_COUNT || 3);
const timeoutSeconds = Number(process.env.TIMEOUT_SECONDS || 300);
const pollSeconds = Number(process.env.POLL_SECONDS || 3);
const smokeMarker = process.env.SMOKE_MARKER;
const deadline = Date.now() + timeoutSeconds * 1000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function waitForDetail(submissionId, predicate, label) {
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const detail = await requestJson(`/submissions/${submissionId}`);
    if (predicate(detail)) return detail;
    if (attempt === 1 || attempt % 10 === 0) {
      console.log(`Waiting for ${label}. attempt=${attempt} status=${detail.status || "unknown"}`);
    }
    await sleep(pollSeconds * 1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function setOrganizationAutoApproval(enabled) {
  return requestJson(`/workflow-policies/organizations/${organizationSlug}`, {
    method: "POST",
    body: JSON.stringify({
      actorEmail: organizationAdminEmail,
      autoApproveInternalLowRisk: enabled,
      autoApproveMaxRisk: 0.35,
      autoApprovalRule: enabled ? { allowedContentTypes: ["photo"] } : {}
    })
  });
}

async function setClubAutoApproval(enabled) {
  return requestJson(`/workflow-policies/clubs/${clubSlug}`, {
    method: "POST",
    body: JSON.stringify({
      actorEmail: clubAdminEmail,
      autoApproveInternalLowRisk: enabled,
      autoApproveMaxRisk: 0.35,
      autoApprovalRule: enabled ? { allowedContentTypes: ["photo"] } : {}
    })
  });
}

async function inheritClubAutoApproval() {
  return requestJson(`/workflow-policies/clubs/${clubSlug}`, {
    method: "POST",
    body: JSON.stringify({
      actorEmail: clubAdminEmail,
      autoApproveInternalLowRisk: null,
      autoApproveMaxRisk: null,
      autoApprovalRule: null
    })
  });
}

async function createSubmission(rawText) {
  const payload = await requestJson("/submissions", {
    method: "POST",
    body: JSON.stringify({
      clubSlug,
      teamSlug,
      submitterEmail,
      contentType: "photo",
      visibilityTarget: "internal",
      rawText,
      media: []
    })
  });
  return payload.submission.id;
}

async function main() {
  console.log(`Checking API health: ${apiBaseUrl}`);
  await requestJson("/health");

  console.log(`smoke_marker=${smokeMarker}`);
  console.log("phase=manual_review");
  await setOrganizationAutoApproval(false);
  await setClubAutoApproval(false);

  const manualItems = Array.from({ length: manualCount }, (_, index) => ({
    rawText: `${smokeMarker}-manual-${index + 1}`
  }));

  for (const item of manualItems) {
    item.id = await createSubmission(item.rawText);
    console.log(`created_manual=${item.id}`);
  }

  for (const item of manualItems) {
    const detail = await waitForDetail(
      item.id,
      (candidate) => candidate.latestApprovalRequest?.id,
      `manual review queue ${item.id}`
    );
    item.approvalRequestId = detail.latestApprovalRequest.id;
    console.log(`queued_manual=${item.id}`);
    console.log(`approval_request_id=${item.approvalRequestId}`);
  }

  for (const item of manualItems) {
    await requestJson(`/approval-requests/${item.approvalRequestId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        actedByEmail: reviewerEmail,
        notes: "Batch workflow simulation smoke approval."
      })
    });
    console.log(`approved_manual=${item.id}`);
  }

  for (const item of manualItems) {
    const detail = await waitForDetail(
      item.id,
      (candidate) => candidate.status === "published" && candidate.publishedPost?.id,
      `manual publish ${item.id}`
    );
    console.log(`published_manual=${item.id}`);
    console.log(`published_post_id=${detail.publishedPost.id}`);
  }

  console.log("phase=auto_approval");
  await setOrganizationAutoApproval(true);
  await inheritClubAutoApproval();

  const autoItems = Array.from({ length: autoCount }, (_, index) => ({
    rawText: `${smokeMarker}-auto-${index + 1}`
  }));

  for (const item of autoItems) {
    item.id = await createSubmission(item.rawText);
    console.log(`created_auto=${item.id}`);
  }

  for (const item of autoItems) {
    const detail = await waitForDetail(
      item.id,
      (candidate) =>
        candidate.status === "published" &&
        candidate.routing_decision?.autoApproved === true &&
        candidate.publishedPost?.id,
      `auto publish ${item.id}`
    );
    if (detail.latestApprovalRequest) {
      throw new Error(`Auto-approved submission unexpectedly has an approval request: ${item.id}`);
    }
    console.log(`published_auto=${item.id}`);
    console.log(`auto_approve_reason=${detail.routing_decision.autoApproveReason}`);
  }

  console.log("cleanup=restore_demo_club_manual_review");
  await setClubAutoApproval(false);

  const finalQueue = await requestJson("/approvals/queue");
  const leftovers = (finalQueue.items || []).filter((item) =>
    String(item.raw_text || "").startsWith(smokeMarker)
  );
  if (leftovers.length) {
    throw new Error(`Batch smoke left pending approvals: ${JSON.stringify(leftovers)}`);
  }

  console.log("Batch workflow simulation smoke passed.");
  console.log(`manual_count=${manualItems.length}`);
  console.log(`auto_count=${autoItems.length}`);
  console.log(`final_queue_count=${finalQueue.items?.length || 0}`);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await setClubAutoApproval(false);
  } catch (cleanupError) {
    console.error(`Cleanup failed: ${cleanupError.message}`);
  }
  process.exit(1);
});
NODE
