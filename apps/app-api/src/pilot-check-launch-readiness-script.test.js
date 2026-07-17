import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-check-launch-readiness-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_check_launch_readiness.sh");
  const targetPath = path.join(scriptsDir, "pilot_check_launch_readiness.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  return repoRoot;
}

test("pilot launch readiness accepts a worksheet with recorded evidence and signoff", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_check_launch_readiness.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Real Club",
      "",
      "## People and Roles",
      "",
      "- Executive sponsor: Taylor Director <taylor@example.com>",
      "- Day-to-day club lead: Casey Admin <casey@example.com>",
      "",
      "## Approval and Publishing Rules",
      "",
      "- Internal destinations: internal_feed",
      "- Public destinations: internal_feed",
      "",
      "## Demo and QA Evidence",
      "",
      "- Operator demo completed: yes",
      "- Mobile review smoke completed: passed",
      "- Pilot VPS scenario suite completed: completed",
      "- Open rollout blockers: none",
      "- Go-live owner signoff: Taylor Director"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, onboardingPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_launch_readiness=GO/);
  assert.match(output, /pilot_launch_readiness_next_step=apply_create_sql/);
});

test("pilot launch readiness blocks when prelaunch evidence is incomplete", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_check_launch_readiness.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Real Club",
      "",
      "## People and Roles",
      "",
      "- Executive sponsor:",
      "- Day-to-day club lead: Casey Admin <casey@example.com>",
      "",
      "## Approval and Publishing Rules",
      "",
      "- Internal destinations:",
      "- Public destinations: internal_feed",
      "",
      "## Demo and QA Evidence",
      "",
      "- Operator demo completed: no",
      "- Mobile review smoke completed: pending",
      "- Pilot VPS scenario suite completed: yes",
      "- Open rollout blockers: waiting on reviewer signoff",
      "- Go-live owner signoff:"
    ].join("\n")
  );

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath, onboardingPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.fail("expected launch readiness to fail");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_launch_readiness=NO_GO/);
  assert.match(output, /pilot_launch_readiness_next_step=finish_prelaunch_checklist/);
  assert.match(output, /launch_readiness_issue=executive_sponsor/);
  assert.match(output, /launch_readiness_issue_label=Executive sponsor/);
  assert.match(output, /launch_readiness_issue=operator_demo_completed/);
  assert.match(output, /launch_readiness_issue=open_rollout_blockers/);
  assert.match(output, /launch_readiness_issue=go_live_owner_signoff/);
});
