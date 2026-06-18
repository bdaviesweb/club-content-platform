import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/auto_approval_override_smoke_vps.sh");

function createFakeBin() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-auto-approval-override-"));
  const curlPath = path.join(tempDir, "curl");
  const dockerPath = path.join(tempDir, "docker");
  const statePath = path.join(tempDir, "state.json");

  fs.writeFileSync(statePath, JSON.stringify({ curlCalls: [], clubOverrideEnabled: false }, null, 2));

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
if (url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" && body && body.includes('"autoApproveInternalLowRisk":false')) {
  state.clubOverrideEnabled = true;
}
if (url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" && body && body.includes('"autoApproveInternalLowRisk":null')) {
  state.clubOverrideEnabled = false;
}
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
if (url === "http://localhost:4000/health") {
  process.stdout.write(JSON.stringify({ service: "app-api", status: "ok" }));
  process.exit(0);
}
if (url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" && !body) {
  process.stdout.write(JSON.stringify(state.clubOverrideEnabled ? {
    organizationPolicy: { autoApproveInternalLowRisk: true },
    clubPolicy: { autoApproveInternalLowRisk: false },
    effectivePolicy: { autoApproveInternalLowRisk: false }
  } : {
    organizationPolicy: { autoApproveInternalLowRisk: true, autoApprovalRule: { allowedContentTypes: ["photo"] } },
    clubPolicy: { autoApproveInternalLowRisk: null },
    effectivePolicy: { autoApproveInternalLowRisk: true, autoApprovalRule: { allowedContentTypes: ["photo"] } }
  }));
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
if (args.includes("WHERE s.raw_text = 'auto-approval-override-test'")) {
  process.stdout.write("submission-org|published||true|policy_auto_approve_low_risk_internal|succeeded|");
  process.exit(0);
}
if (args.includes("WHERE s.raw_text = 'auto-approval-override-test-club-override'")) {
  process.stdout.write("submission-club|needs_review|approval-1|pending|||");
  process.exit(0);
}
console.error("Unexpected fake docker command:\\n" + args);
process.exit(1);
`
  );
  fs.chmodSync(dockerPath, 0o755);

  return { tempDir, statePath, cleanup() { fs.rmSync(tempDir, { recursive: true, force: true }); } };
}

test("auto-approval override smoke proves club disables can beat organization auto-approval", () => {
  const fakeBin = createFakeBin();
  try {
    const output = execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin.tempDir}:${process.env.PATH}`, FAKE_STATE_PATH: fakeBin.statePath, CLUB_CONTENT_SMOKE_ON_VPS: "1", SMOKE_MARKER: "auto-approval-override-test" }
    });

    const state = JSON.parse(fs.readFileSync(fakeBin.statePath, "utf8"));
    assert.match(output, /Organization-default auto-approval smoke passed\./);
    assert.match(output, /phase=organization_default/);
    assert.match(output, /Club override auto-approval smoke passed\./);
    assert.match(output, /phase=club_override/);
    assert.ok(state.curlCalls.find((call) => call.url === "http://localhost:4000/workflow-policies/organizations/demo-sports-org"));
    assert.ok(state.curlCalls.find((call) => call.body && call.body.includes('"autoApproveInternalLowRisk":false')));
  } finally {
    fakeBin.cleanup();
  }
});
