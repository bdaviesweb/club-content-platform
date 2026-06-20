import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/routing_rule_smoke_vps.sh");

function createFakeBin() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-routing-rule-smoke-"));
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

if (url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club") {
  process.stdout.write(
    JSON.stringify({
      organizationPolicy: {
        routingRule: { contentTypeApprovers: { video: "club_admin" } }
      },
      clubPolicy: {
        routingRule: { contentTypeApprovers: { video: "team_manager" } }
      },
      effectivePolicy: {
        routingRule: { contentTypeApprovers: { video: "team_manager" } }
      }
    })
  );
  process.exit(0);
}

process.exit(0);
`
  );
  fs.chmodSync(curlPath, 0o755);

  fs.writeFileSync(
    dockerPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");

if (args.includes("SELECT") && args.includes("routing_decision->>'approverRole'")) {
  process.stdout.write("submission-1|needs_review|approval-1|club_comms|team_manager|team_manager|routing_rule_content_type|workflow_policy|");
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

test("routing rule smoke proves club overrides win over organization defaults", () => {
  const fakeBin = createFakeBin();

  try {
    const output = execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin.tempDir}:${process.env.PATH}`,
        FAKE_STATE_PATH: fakeBin.statePath,
        CLUB_CONTENT_SMOKE_ON_VPS: "1"
      }
    });

    const state = JSON.parse(fs.readFileSync(fakeBin.statePath, "utf8"));
    const orgPatch = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/organizations/demo-sports-org" &&
        call.body
    );
    const clubPatch = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
        call.body &&
        call.body.includes('"actorEmail":"comms@demo-club.local"')
    );
    const cleanupCall = state.curlCalls.find(
      (call) =>
        call.url === "http://localhost:4000/approval-requests/approval-1/actions"
    );

    assert.match(output, /Routing rule smoke passed\./);
    assert.match(output, /approver_role=club_comms/);
    assert.match(output, /originally_requested_role=team_manager/);
    assert.match(output, /organization_video_role=club_admin/);
    assert.match(output, /club_video_role=team_manager/);
    assert.match(output, /effective_video_role=team_manager/);

    assert.ok(orgPatch, "Expected organization routing rule patch call");
    assert.match(
      orgPatch.body,
      /"contentTypeApprovers":\{"video":"club_admin"\}/
    );

    assert.ok(clubPatch, "Expected club routing override patch call");
    assert.match(
      clubPatch.body,
      /"contentTypeApprovers":\{"video":"team_manager"\}/
    );

    assert.ok(cleanupCall, "Expected cleanup approval action call");
    assert.match(
      cleanupCall.body,
      /"actedByEmail":"comms@demo-club\.local"/
    );
  } finally {
    fakeBin.cleanup();
  }
});
