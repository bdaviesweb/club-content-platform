import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/event_notification_rule_smoke_vps.sh");

function createFakeBin() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-event-notification-smoke-"));
  const curlPath = path.join(tempDir, "curl");
  const dockerPath = path.join(tempDir, "docker");
  const statePath = path.join(tempDir, "state.json");

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        curlCalls: [],
        clubOverrideEnabled: false
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

if (
  url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
  body &&
  body.includes('"notificationRule":{"email":true,"push":true}')
) {
  state.clubOverrideEnabled = true;
}

if (
  url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
  body &&
  body.includes('"notificationRule":null')
) {
  state.clubOverrideEnabled = false;
}

fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

if (url === "http://localhost:4000/health") {
  process.stdout.write(JSON.stringify({ service: "app-api", status: "ok" }));
  process.exit(0);
}

if (url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" && !body) {
  if (state.clubOverrideEnabled) {
    process.stdout.write(
      JSON.stringify({
        clubPolicy: {
          notificationRule: {
            email: true,
            push: true
          }
        },
        effectivePolicy: {
          notificationRule: {
            email: true,
            push: true
          }
        }
      })
    );
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify({
      clubPolicy: {
        notificationRule: null
      },
      effectivePolicy: {
        notificationRule: {
          email: true,
          push: true,
          eventChannels: {
            submission_review_started: {
              email: false,
              push: false
            }
          }
        }
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

if (args.includes("SELECT COUNT(*)") && args.includes("submission_published")) {
  process.stdout.write("0");
  process.exit(0);
}

if (args.includes("WHERE s.raw_text = 'event-notification-test'")) {
  process.stdout.write(
    "submission-1|approval-1|notification-1|submission_review_started|notification_policy_email_event_disabled|notification_policy_push_event_disabled|needs_review|"
  );
  process.exit(0);
}

if (args.includes("WHERE s.raw_text = 'event-notification-test-club-override'")) {
  process.stdout.write(
    "submission-2|approval-2|notification-2|submission_review_started|missing_resend_config|no_active_push_tokens|needs_review|"
  );
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

test("event notification smoke proves club overrides replace organization event-channel rules", () => {
  const fakeBin = createFakeBin();

  try {
    const output = execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin.tempDir}:${process.env.PATH}`,
        FAKE_STATE_PATH: fakeBin.statePath,
        CLUB_CONTENT_SMOKE_ON_VPS: "1",
        SMOKE_MARKER: "event-notification-test"
      }
    });

    const state = JSON.parse(fs.readFileSync(fakeBin.statePath, "utf8"));
    const orgPolicyPatch = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/organizations/demo-sports-org" &&
        call.body &&
        call.body.includes('"submission_review_started":{"email":false,"push":false}')
    );
    const clubClearPatch = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
        call.body &&
        call.body.includes('"notificationRule":null')
    );
    const clubOverridePatch = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
        call.body &&
        call.body.includes('"notificationRule":{"email":true,"push":true}')
    );
    const cleanupCalls = state.curlCalls.filter(
      (call) => call.url?.startsWith("http://localhost:4000/approval-requests/")
    );

    assert.match(output, /Event notification rule smoke passed\./);
    assert.match(output, /phase=organization_default/);
    assert.match(output, /Club override notification smoke passed\./);
    assert.match(output, /phase=club_override/);
    assert.match(output, /override_email_reason=missing_resend_config/);
    assert.match(output, /override_push_reason=no_active_push_tokens/);

    assert.ok(orgPolicyPatch, "Expected organization event-channel patch call");
    assert.ok(clubClearPatch, "Expected club notification clear call");
    assert.ok(clubOverridePatch, "Expected club notification override call");
    assert.equal(cleanupCalls.length, 2, "Expected cleanup for both smoke submissions");
  } finally {
    fakeBin.cleanup();
  }
});

test("event notification smoke prefers the explicit scenario reviewer", () => {
  const fakeBin = createFakeBin();

  try {
    execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin.tempDir}:${process.env.PATH}`,
        FAKE_STATE_PATH: fakeBin.statePath,
        CLUB_CONTENT_SMOKE_ON_VPS: "1",
        SMOKE_MARKER: "event-notification-test",
        TEAM_MANAGER_REVIEWER_EMAIL: "manager@example.test"
      }
    });

    const state = JSON.parse(fs.readFileSync(fakeBin.statePath, "utf8"));
    const cleanupBodies = state.curlCalls
      .filter((call) => call.url?.startsWith("http://localhost:4000/approval-requests/"))
      .map((call) => call.body);

    assert.equal(cleanupBodies.length, 2);
    assert.ok(cleanupBodies.every((body) => body.includes('"actedByEmail":"manager@example.test"')));
  } finally {
    fakeBin.cleanup();
  }
});
