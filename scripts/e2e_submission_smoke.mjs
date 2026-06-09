import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:4000";
const clubSlug = process.env.E2E_CLUB_SLUG || "demo-soccer-club";
const teamSlug = process.env.E2E_TEAM_SLUG || "u14-girls";
const submitterEmail = process.env.E2E_SUBMITTER_EMAIL || "coach@demo-club.local";
const selectedChannels = (process.env.E2E_SELECTED_CHANNELS || "club-instagram,club-facebook")
  .split(",")
  .map((channel) => channel.trim())
  .filter(Boolean);
const rawText =
  process.env.E2E_RAW_TEXT ||
  [
    "E2E smoke post for Club Content",
    `Channels: ${selectedChannels.join(", ")}`,
    "Tags: smoke, e2e"
  ].join("\n");
const visibilityTarget = process.env.E2E_VISIBILITY_TARGET || "internal";
const waitMs = Number(process.env.E2E_WAIT_MS || 2000);
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 30000);

const samplePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z7XcAAAAASUVORK5CYII=",
  "base64"
);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkResponse(response, label) {
  if (response.ok) return;
  const text = await response.text();
  throw new Error(`${label} failed: ${response.status} ${text}`);
}

async function createTempFile() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clubcontent-e2e-"));
  const filePath = path.join(tmpDir, "smoke.png");
  await fs.writeFile(filePath, samplePng);
  return { tmpDir, filePath };
}

async function main() {
  const healthResponse = await fetch(`${apiBaseUrl}/health`);
  await checkResponse(healthResponse, "health");

  const { tmpDir, filePath } = await createTempFile();
  const uploadResponse = await fetch(`${apiBaseUrl}/uploads/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clubSlug,
      files: [
        {
          filename: "smoke.png",
          mimeType: "image/png",
          mediaType: "image"
        }
      ]
    })
  });
  await checkResponse(uploadResponse, "upload signing");
  const uploadPayload = await uploadResponse.json();
  const uploadPlan = uploadPayload.uploads?.[0];
  assert.ok(uploadPlan, "upload plan missing");

  const uploadBody = await fs.readFile(filePath);
  const putResponse = await fetch(uploadPlan.uploadUrl, {
    method: uploadPlan.method || "PUT",
    headers: uploadPlan.headers || { "content-type": "image/png" },
    body: uploadBody
  });
  await checkResponse(putResponse, "media upload");

  const submissionResponse = await fetch(`${apiBaseUrl}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clubSlug,
      teamSlug,
      submitterEmail,
      contentType: "photo",
      rawText,
      selectedChannels,
      visibilityTarget,
      media: [
        {
          objectKey: uploadPlan.objectKey,
          mediaType: "image",
          mimeType: "image/png"
        }
      ]
    })
  });
  await checkResponse(submissionResponse, "submission create");
  const submissionPayload = await submissionResponse.json();
  const submissionId = submissionPayload.submission?.id;
  assert.ok(submissionId, "submission id missing");

  const startedAt = Date.now();
  let submissionDetail = null;
  let queuePayload = null;

  while (Date.now() - startedAt < timeoutMs) {
    const [detailResponse, queueResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/submissions/${submissionId}`),
      fetch(`${apiBaseUrl}/approvals/queue`)
    ]);
    await checkResponse(detailResponse, "submission detail");
    await checkResponse(queueResponse, "approvals queue");

    submissionDetail = await detailResponse.json();
    queuePayload = await queueResponse.json();

    const queueHit = Array.isArray(queuePayload.items)
      ? queuePayload.items.find((item) => item.submission_id === submissionId)
      : null;

    if (submissionDetail.status === "needs_human_review" || queueHit) {
      break;
    }

    await sleep(waitMs);
  }

  const queueHit = Array.isArray(queuePayload?.items)
    ? queuePayload.items.find((item) => item.submission_id === submissionId)
    : null;

  assert.ok(submissionDetail, "submission detail missing");
  const reviewPath = submissionDetail.status === "needs_human_review" || Boolean(queueHit);
  const publishedPath = ["approved_internal", "approved", "published"].includes(
    String(submissionDetail.status || "")
  );
  assert.ok(
    reviewPath || publishedPath,
    `submission ${submissionId} ended in unexpected status: ${submissionDetail.status}`
  );

  process.stdout.write(
    JSON.stringify(
      {
        submissionId,
        status: submissionDetail.status,
        routingDecision: submissionDetail.routing_decision,
        path: reviewPath ? "review" : "publish",
        inQueue: Boolean(queueHit),
        selectedChannels: submissionDetail.selected_channels || []
      },
      null,
      2
    ) + "\n"
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
