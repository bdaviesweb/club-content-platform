import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-launch-reply-template-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeExecutable(pathname, contents) {
  fs.writeFileSync(pathname, contents);
  fs.chmodSync(pathname, 0o755);
}

function setupFixtureRepo({ preflightExitCode = 0, launchExitCode = 0 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_launch_from_reply_template.sh");
  const targetPath = path.join(scriptsDir, "pilot_launch_from_reply_template.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  writeExecutable(
    path.join(scriptsDir, "pilot_preflight_from_reply_template.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "prep_root=\"$(dirname \"$2\")/prep-bundle\"",
      "mkdir -p \"$prep_root/subdir\"",
      "applied_onboarding=\"$prep_root/subdir/pilot-onboarding.applied.md\"",
      "cp \"$1\" \"$applied_onboarding\"",
      "echo \"pilot_reply_template_preflight_prep_bundle=$prep_root\"",
      "echo \"pilot_reply_template_preflight_candidate_profile=real-club-pilot\"",
      "echo \"pilot_reply_template_preflight_candidate_profile_path=/tmp/real-club-pilot.local.env\"",
      "echo \"pilot_reply_template_preflight_create_sql=/tmp/create.sql\"",
      "echo \"pilot_reply_template_preflight_rollback_sql=/tmp/rollback.sql\"",
      "echo \"pilot_reply_template_preflight_profile_preflight=$([[ " + preflightExitCode + " -eq 0 ]] && echo ok || echo failed)\"",
      `exit ${preflightExitCode}`
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_launch_from_onboarding.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo \"pilot_real_launch_bundle_path=/tmp/launch-bundle\"",
      "echo \"pilot_real_launch_handoff_path=/tmp/launch-handoff.md\"",
      "echo \"pilot_real_launch_create_bundle=/tmp/create-bundle\"",
      "echo \"pilot_real_launch_verify_bundle=/tmp/verify-bundle\"",
      "echo \"pilot_real_launch_rollback_bundle=/tmp/rollback-bundle\"",
      "echo \"pilot_real_launch_rollback_command=PILOT_CANDIDATE_PROFILE=real-club-pilot npm run pilot:apply-sql -- real-club-pilot rollback\"",
      "echo \"pilot_real_launch_decision=$([[ " + launchExitCode + " -eq 0 ]] && echo GO || echo NO_GO)\"",
      `exit ${launchExitCode}`
    ].join("\n")
  );

  return repoRoot;
}

test("launch from reply template runs local preflight then hosted launch", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_launch_from_reply_template.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const replyTemplatePath = path.join(repoRoot, "tmp", "pilot-real-data-reply-template.txt");
  const outputRoot = path.join(repoRoot, "tmp", "launch-output");

  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");
  fs.writeFileSync(replyTemplatePath, "Candidate identity\n- Candidate profile name: real-club-pilot\n");

  const output = execFileSync("bash", [scriptPath, onboardingPath, replyTemplatePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REPLY_TEMPLATE_LAUNCH_OUTPUT_DIR: outputRoot
    }
  });

  assert.match(output, /pilot_reply_template_launch_decision=GO/);
  assert.match(output, /pilot_reply_template_launch_candidate_profile=real-club-pilot/);
  assert.match(output, /pilot_reply_template_launch_profile_preflight=ok/);
  assert.match(output, /pilot_reply_template_launch_create_bundle=\/tmp\/create-bundle/);
  assert.match(output, /pilot_reply_template_launch_next_step=operator_demo_and_evidence_capture/);

  const bundlePath = output.match(/^pilot_reply_template_launch_bundle=(.*)$/m)?.[1];
  assert.ok(bundlePath);
  assert.equal(fs.existsSync(path.join(bundlePath, "README.md")), true);
});

test("launch from reply template stops when local preflight fails", () => {
  const repoRoot = setupFixtureRepo({ preflightExitCode: 1 });
  const scriptPath = path.join(repoRoot, "scripts", "pilot_launch_from_reply_template.sh");
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
    assert.fail("expected launch-from-reply-template to fail");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_reply_template_launch_decision=NO_GO/);
  assert.match(output, /pilot_reply_template_launch_profile_preflight=failed/);
  assert.match(output, /pilot_reply_template_launch_next_step=review_summary_bundle/);
});
