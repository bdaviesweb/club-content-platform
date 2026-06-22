import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/approval_publish_smoke_vps.sh");

function createFakeBin({ approverRole = "club_comms" } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-approval-publish-"));
  const curlPath = path.join(tempDir, "curl");
  const dockerPath = path.join(tempDir, "docker");
  const statePath = path.join(tempDir, "state.json");

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        curlCalls: []
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    curlPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.FAKE_STATE_PATH;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const url = args[args.length - 1];
const dataIndex = args.findIndex((arg) => arg === "-d");
const body = dataIndex >= 0 ? args[dataIndex + 1] : null;
state.curlCalls.push({ url, body });
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
if (url === "http://localhost:4000/health") {
  process.stdout.write(JSON.stringify({ service: "app-api", status: "ok" }));
  process.exit(0);
}
if (url === "http://localhost:4000/submissions/submission-1") {
  process.stdout.write(JSON.stringify({
    id: "submission-1",
    status: "published",
    publishedPost: {
      externalPostId: "internal:submission-1",
      destinationType: "internal_feed",
      destinationName: "Internal Club Feed",
      publishedAt: "2026-06-22T20:00:00.000Z"
    },
    latestReviewRun: {
      summary: "summary"
    },
    latestApprovalRequest: {
      id: "approval-1",
      state: "approved"
    },
    routing_decision: {
      reviewMode: "hermes",
      routingSource: "hermes_agent"
    }
  }));
}
process.exit(0);
`
  );
  fs.chmodSync(curlPath, 0o755);

  fs.writeFileSync(
    dockerPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("WHERE ar.state = 'pending'")) {
  process.exit(0);
}
if (args.includes("WHERE s.raw_text = 'approval-publish-smoke-test'")) {
  process.stdout.write("submission-1|needs_human_review|approval-1|pending|hermes|llama3.2:3b-instruct-q4_K_M|summary|");
  process.exit(0);
}
if (args.includes("SELECT COALESCE(approver_role::text, '')") && args.includes("WHERE id = 'approval-1'")) {
  process.stdout.write(${JSON.stringify(approverRole)});
  process.exit(0);
}
if (args.includes("WHERE s.id = 'submission-1'")) {
  process.stdout.write("published|approved|succeeded|Published to internal feed by worker|internal:submission-1|");
  process.exit(0);
}
if (args.includes("WHERE submission_id = 'submission-1'") && args.includes("event_name = 'submission.published'")) {
  process.stdout.write(JSON.stringify({
    destinationCount: 1,
    destinations: [{ destinationType: "internal_feed", destinationName: "Internal Club Feed" }],
    destinationType: "internal_feed",
    destinationName: "Internal Club Feed",
    policySource: "publishing_rule_visibility_internal"
  }));
  process.exit(0);
}
if (args.includes("SELECT COUNT(*)") && args.includes("FROM approval_requests")) {
  process.stdout.write("0");
  process.exit(0);
}
console.error("Unexpected fake docker command:\\n" + args);
process.exit(1);
`
  );
  fs.chmodSync(dockerPath, 0o755);

  return {
    tempDir,
    statePath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

test("approval publish smoke uses the team-manager reviewer when the request is routed there", () => {
  const fakeBin = createFakeBin({ approverRole: "team_manager" });
  try {
    execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin.tempDir}:${process.env.PATH}`,
        FAKE_STATE_PATH: fakeBin.statePath,
        CLUB_CONTENT_SMOKE_ON_VPS: "1",
        SMOKE_MARKER: "approval-publish-smoke-test",
        REVIEWER_EMAIL: "comms@example.test",
        TEAM_MANAGER_REVIEWER_EMAIL: "manager@example.test",
        CLUB_ADMIN_EMAIL: "admin@example.test"
      }
    });

    const state = JSON.parse(fs.readFileSync(fakeBin.statePath, "utf8"));
    const actionCall = state.curlCalls.find(
      (call) => call.url === "http://localhost:4000/approval-requests/approval-1/actions"
    );
    assert.ok(actionCall, "Expected approval action call");
    assert.match(actionCall.body, /"actedByEmail":"manager@example\.test"/);
  } finally {
    fakeBin.cleanup();
  }
});

test("approval publish smoke falls back to the club comms reviewer for club_comms approvals", () => {
  const fakeBin = createFakeBin({ approverRole: "club_comms" });
  try {
    execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin.tempDir}:${process.env.PATH}`,
        FAKE_STATE_PATH: fakeBin.statePath,
        CLUB_CONTENT_SMOKE_ON_VPS: "1",
        SMOKE_MARKER: "approval-publish-smoke-test",
        REVIEWER_EMAIL: "comms@example.test",
        TEAM_MANAGER_REVIEWER_EMAIL: "manager@example.test",
        CLUB_ADMIN_EMAIL: "admin@example.test"
      }
    });

    const state = JSON.parse(fs.readFileSync(fakeBin.statePath, "utf8"));
    const actionCall = state.curlCalls.find(
      (call) => call.url === "http://localhost:4000/approval-requests/approval-1/actions"
    );
    assert.ok(actionCall, "Expected approval action call");
    assert.match(actionCall.body, /"actedByEmail":"comms@example\.test"/);
  } finally {
    fakeBin.cleanup();
  }
});
