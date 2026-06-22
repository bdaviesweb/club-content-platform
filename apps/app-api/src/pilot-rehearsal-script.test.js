import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_rehearsal.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-rehearsal-output-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("pilot rehearsal script runs the full test-tenant flow in order", () => {
  const outputDir = path.join(tempRoot, "bundle-a");
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      PILOT_CANDIDATE_PROFILE: "simulated-north-river",
      PILOT_REHEARSAL_OUTPUT_DIR: outputDir
    }
  });

  assert.match(output, /pilot_rehearsal_profile=simulated-north-river/);
  assert.match(output, /pilot_rehearsal_profile_path=.*simulated-north-river\.env/);
  assert.match(output, /pilot_rehearsal_bundle_path=.*bundle-a.*simulated-north-river/);
  assert.match(output, /pilot_rehearsal_summary_path=.*summary\.txt/);
  assert.match(output, /pilot_rehearsal_handoff_path=.*handoff\.md/);
  assert.match(output, /==> Inspect test-tenant profile/);
  assert.match(output, /DRY_RUN npm run pilot:inspect -- simulated-north-river/);
  assert.match(output, /==> Validate test-tenant profile/);
  assert.match(
    output,
    /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river bash scripts\/validate_pilot_candidate_profile\.sh/
  );
  assert.match(output, /==> Run backend audit/);
  assert.match(output, /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:audit/);
  assert.match(output, /==> Run VPS rehearsal/);
  assert.match(output, /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:vps/);
  assert.match(output, /==> Verify demo UI contract/);
  assert.match(output, /DRY_RUN node --test .*apps\/admin-web\/server\.test\.js/);
  assert.match(output, /pilot_rehearsal_decision=GO/);
  assert.match(output, /pilot_rehearsal_result=ok/);

  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName, "expected a rehearsal bundle directory");

  const bundleDir = path.join(outputDir, bundleName);
  assert.equal(fs.existsSync(path.join(bundleDir, "summary.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "handoff.md")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "status.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "commands.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "inspect.log")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "demo-ui.log")), true);

  const summary = fs.readFileSync(path.join(bundleDir, "summary.txt"), "utf8");
  assert.match(summary, /pilot_rehearsal_decision=GO/);
  assert.match(summary, /inspect=skipped/);
  assert.match(summary, /validate=skipped/);
  assert.match(summary, /audit=skipped/);
  assert.match(summary, /vps=skipped/);
  assert.match(summary, /ui=skipped/);

  const commands = fs.readFileSync(path.join(bundleDir, "commands.txt"), "utf8");
  assert.match(commands, /npm run pilot:inspect -- simulated-north-river/);
  assert.match(commands, /env PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:audit/);
  assert.match(commands, /node --test /);

  const handoff = fs.readFileSync(path.join(bundleDir, "handoff.md"), "utf8");
  assert.match(handoff, /# Pilot Rehearsal Handoff/);
  assert.match(handoff, /Decision: `GO`/);
  assert.match(handoff, /Tenant: `Demo Sports Organization test tenant`/);
  assert.match(handoff, /Demo command center: `http:\/\/127\.0\.0\.1:3013\/demo`/);
  assert.match(handoff, /Quick review: `http:\/\/127\.0\.0\.1:3013\/quick-review`/);
  assert.match(handoff, /Workflow settings: `http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club`/);
  assert.match(handoff, /Internal feed API: `https:\/\/clubcontent-api\.davmn\.net\/feed\/internal\?includeSmoke=1`/);
});

test("pilot rehearsal script defaults to the committed simulator profile", () => {
  const outputDir = path.join(tempRoot, "bundle-b");
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      PILOT_REHEARSAL_OUTPUT_DIR: outputDir
    }
  });

  assert.match(output, /pilot_rehearsal_profile=simulated-north-river/);
  assert.match(output, /DRY_RUN npm run pilot:inspect -- simulated-north-river/);
  assert.match(output, /pilot_rehearsal_decision=GO/);
});
