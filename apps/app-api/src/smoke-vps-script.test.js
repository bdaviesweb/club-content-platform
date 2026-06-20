import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/smoke_vps.sh");

function createFakeCurlBin({
  appReadiness,
  clubWorkflowPolicy,
  organizationWorkflowPolicy,
  organizationDirectory,
  approvalQueue = { items: [] },
  workflowEvents = { items: [] },
  notificationDeliveryStatus = {
    email: { enabled: false, mode: "log-only" },
    push: { enabled: false, mode: "disabled", registrationEndpoint: "/push-tokens" }
  },
  apiHealth = { service: "app-api", status: "ok" },
  adminHealth = { service: "admin-web", status: "ok" },
  workflowSettingsHtml = "<html><body><h1>Workflow settings</h1><p>Set routing rules by club or by organization</p><p>westside</p></body></html>"
}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-fake-curl-"));
  const curlPath = path.join(tempDir, "curl");
  const statePath = path.join(tempDir, "state.json");

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        apiHealth,
        appReadiness,
        adminHealth,
        approvalQueue,
        workflowEvents,
        notificationDeliveryStatus,
        clubWorkflowPolicy,
        organizationWorkflowPolicy,
        organizationDirectory,
        workflowSettingsHtml
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    curlPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_CURL_STATE, "utf8"));
const args = process.argv.slice(2);
const url = args[args.length - 1];

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

if (url === "http://localhost:4000/health") {
  writeJson(state.apiHealth);
  process.exit(0);
}

if (url === "http://localhost:4000/app/readiness") {
  writeJson(state.appReadiness);
  process.exit(0);
}

if (url === "http://localhost:3002/health") {
  writeJson(state.adminHealth);
  process.exit(0);
}

if (url === "http://localhost:4000/approvals/queue") {
  writeJson(state.approvalQueue);
  process.exit(0);
}

if (url === "http://localhost:4000/workflow-events") {
  writeJson(state.workflowEvents);
  process.exit(0);
}

if (url === "http://localhost:4000/notification-delivery/status") {
  writeJson(state.notificationDeliveryStatus);
  process.exit(0);
}

if (url === "http://localhost:4000/workflow-policies/clubs/westside") {
  writeJson(state.clubWorkflowPolicy);
  process.exit(0);
}

if (url === "http://localhost:4000/workflow-policies/organizations/metro") {
  writeJson(state.organizationWorkflowPolicy);
  process.exit(0);
}

if (url === "http://localhost:4000/organizations/metro") {
  writeJson(state.organizationDirectory);
  process.exit(0);
}

if (url === "http://localhost:3002/workflow-settings?clubSlug=westside") {
  process.stdout.write(state.workflowSettingsHtml);
  process.exit(0);
}

console.error("Unexpected fake curl URL:\\n" + url + "\\nArgs:\\n" + args.join(" "));
process.exit(1);
`
  );
  fs.chmodSync(curlPath, 0o755);

  return {
    tempDir,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function runSmokeVps({
  appReadiness = {
    productName: "Club Content",
    demo: { clubSlug: "westside", teamSlug: "u14-girls" },
    capabilities: { submissions: true, review: true },
    checks: []
  },
  clubWorkflowPolicy = {
    scopeType: "club",
    club: { slug: "westside", name: "Westside" },
    organization: { slug: "metro", name: "Metro Sports" },
    effectivePolicy: { defaultApproverRole: "club_admin" }
  },
  organizationWorkflowPolicy = {
    scopeType: "organization",
    organization: { slug: "metro", name: "Metro Sports" }
  },
  organizationDirectory = {
    organization: { slug: "metro", name: "Metro Sports" },
    clubs: [{ slug: "westside", name: "Westside" }],
    admins: [{ role: "organization_admin", email: "org-admin@example.test" }]
  }
} = {}) {
  const fakeCurl = createFakeCurlBin({
    appReadiness,
    clubWorkflowPolicy,
    organizationWorkflowPolicy,
    organizationDirectory
  });

  try {
    return execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurl.tempDir}:${process.env.PATH}`,
        FAKE_CURL_STATE: path.join(fakeCurl.tempDir, "state.json"),
        CLUB_CONTENT_SMOKE_ON_VPS: "1"
      }
    });
  } finally {
    fakeCurl.cleanup();
  }
}

test("smoke_vps verifies the organization directory alongside workflow policy data", () => {
  const output = runSmokeVps();

  assert.match(output, /workflow_settings=ok/);
  assert.match(output, /organization_directory=ok/);
  assert.match(output, /workflow_policy_org=metro/);
  assert.match(output, /organization_club_count=1/);
  assert.match(output, /organization_admin_count=1/);
});

test("smoke_vps fails when the organization directory is missing an organization admin", () => {
  assert.throws(
    () =>
      runSmokeVps({
        organizationDirectory: {
          organization: { slug: "metro", name: "Metro Sports" },
          clubs: [{ slug: "westside", name: "Westside" }],
          admins: [{ role: "organization_ops", email: "ops@example.test" }]
        }
      }),
    /organization directory must include at least one organization admin/
  );
});
