import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-goal-audit-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeExecutable(pathname, contents) {
  fs.writeFileSync(pathname, contents);
  fs.chmodSync(pathname, 0o755);
}

function setupFixtureRepo({ preflightExitCode = 0 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_goal_audit.sh");
  const targetPath = path.join(scriptsDir, "pilot_goal_audit.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  writeExecutable(
    path.join(scriptsDir, "pilot_preflight_from_reply_template.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo \"pilot_reply_template_preflight_candidate_profile=real-club-pilot\"",
      "echo \"pilot_reply_template_preflight_candidate_profile_path=/tmp/real-club-pilot.local.env\"",
      "echo \"pilot_reply_template_preflight_create_sql=/tmp/create.sql\"",
      "echo \"pilot_reply_template_preflight_rollback_sql=/tmp/rollback.sql\"",
      "echo \"pilot_reply_template_preflight_profile_preflight=$([[ " + preflightExitCode + " -eq 0 ]] && echo ok || echo failed)\"",
      "echo \"pilot_reply_template_preflight_readiness=$([[ " + preflightExitCode + " -eq 0 ]] && echo GO || echo NO_GO)\"",
      `exit ${preflightExitCode}`
    ].join("\n")
  );

  return repoRoot;
}

test("goal audit reports local readiness but keeps the overall objective incomplete until hosted steps are run", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_goal_audit.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const replyTemplatePath = path.join(repoRoot, "tmp", "pilot-real-data-reply-template.txt");

  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");
  fs.writeFileSync(replyTemplatePath, "Candidate identity\n- Candidate profile name: real-club-pilot\n");

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath, onboardingPath, replyTemplatePath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.fail("expected goal audit to remain incomplete");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_goal_audit_real_data_status=ready/);
  assert.match(output, /pilot_goal_audit_record_creation_status=not_yet_run/);
  assert.match(output, /pilot_goal_audit_hosted_verification_status=pending/);
  assert.match(output, /pilot_goal_audit_decision=NO_GO/);
});
