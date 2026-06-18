import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/publishing_override_smoke_vps.sh");

function createFakeBin() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-publishing-override-smoke-"));
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
  body.includes('"publishingRule":{"destinations":["internal_feed"]}')
) {
  state.clubOverrideEnabled = true;
}

if (
  url === "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
  body &&
  body.includes('"publishingRule":null')
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
        organizationPolicy: {
          publishingRule: {
            visibilityDestinations: {
              internal: ["internal_feed"]
            }
          }
        },
        clubPolicy: {
          publishingRule: {
            destinations: ["internal_feed"]
          }
        },
        effectivePolicy: {
          publishingRule: {
            destinations: ["internal_feed"]
          }
        }
      })
    );
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify({
      organizationPolicy: {
        publishingRule: {
          visibilityDestinations: {
            internal: ["internal_feed"]
          }
        }
      },
      clubPolicy: {
        publishingRule: null
      },
      effectivePolicy: {
        publishingRule: {
          visibilityDestinations: {
            internal: ["internal_feed"]
          }
        }
      }
    })
  );
  process.exit(0);
}

if (url === "http://localhost:4000/submissions/submission-org") {
  process.stdout.write(
    JSON.stringify({
      id: "submission-org",
      status: "published",
      publishedPost: {
        destinationType: "internal_feed",
        externalPostId: "post-org"
      }
    })
  );
  process.exit(0);
}

if (url === "http://localhost:4000/submissions/submission-club") {
  process.stdout.write(
    JSON.stringify({
      id: "submission-club",
      status: "published",
      publishedPost: {
        destinationType: "internal_feed",
        externalPostId: "post-club"
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

if (args.includes("WHERE s.raw_text = 'publishing-override-test'")) {
  process.stdout.write("submission-org|needs_review|approval-org|pending|");
  process.exit(0);
}

if (args.includes("WHERE s.raw_text = 'publishing-override-test-club-override'")) {
  process.stdout.write("submission-club|needs_review|approval-club|pending|");
  process.exit(0);
}

if (args.includes("WHERE s.id = 'submission-org'")) {
  process.stdout.write("published|approved|succeeded|post-org|");
  process.exit(0);
}

if (args.includes("WHERE s.id = 'submission-club'")) {
  process.stdout.write("published|approved|succeeded|post-club|");
  process.exit(0);
}

if (args.includes("submission_id = 'submission-org'") && args.includes("submission.published")) {
  process.stdout.write(
    JSON.stringify({
      policySource: "publishing_rule_visibility_internal",
      destinationType: "internal_feed",
      destinations: [{ destinationType: "internal_feed" }]
    })
  );
  process.exit(0);
}

if (args.includes("submission_id = 'submission-club'") && args.includes("submission.published")) {
  process.stdout.write(
    JSON.stringify({
      policySource: "publishing_rule_destinations",
      destinationType: "internal_feed",
      destinations: [{ destinationType: "internal_feed" }]
    })
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

test("publishing override smoke proves club publishing rules replace organization visibility rules", () => {
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
        SMOKE_MARKER: "publishing-override-test"
      }
    });

    const state = JSON.parse(fs.readFileSync(fakeBin.statePath, "utf8"));
    const orgPatch = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/organizations/demo-sports-org" &&
        call.body &&
        call.body.includes('"visibilityDestinations":{"internal":["internal_feed"],"public":["internal_feed"]}')
    );
    const clubClear = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
        call.body &&
        call.body.includes('"publishingRule":null')
    );
    const clubOverride = state.curlCalls.find(
      (call) =>
        call.url ===
          "http://localhost:4000/workflow-policies/clubs/demo-soccer-club" &&
        call.body &&
        call.body.includes('"publishingRule":{"destinations":["internal_feed"]}')
    );

    assert.match(output, /org_default publish passed\./);
    assert.match(output, /org_default_policy_source=publishing_rule_visibility_internal/);
    assert.match(output, /phase=organization_default/);
    assert.match(output, /club_override publish passed\./);
    assert.match(output, /club_override_policy_source=publishing_rule_destinations/);
    assert.match(output, /phase=club_override/);

    assert.ok(orgPatch, "Expected organization visibility publish rule patch");
    assert.ok(clubClear, "Expected club publish rule clear");
    assert.ok(clubOverride, "Expected club publish override patch");
  } finally {
    fakeBin.cleanup();
  }
});
