import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-preflight-reply-template-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeExecutable(pathname, contents) {
  fs.writeFileSync(pathname, contents);
  fs.chmodSync(pathname, 0o755);
}

function setupFixtureRepo({ prepareExitCode = 0, validateExitCode = 0 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_preflight_from_reply_template.sh");
  const targetPath = path.join(scriptsDir, "pilot_preflight_from_reply_template.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  writeExecutable(
    path.join(scriptsDir, "pilot_prepare_from_reply_template.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo \"pilot_reply_template_prep_bundle=/tmp/prep-bundle\"",
      "echo \"pilot_reply_template_prep_candidate_profile=real-club-pilot\"",
      "echo \"pilot_reply_template_prep_candidate_profile_path=/tmp/real-club-pilot.local.env\"",
      "echo \"pilot_reply_template_prep_creation_plan=/tmp/creation-plan.md\"",
      "echo \"pilot_reply_template_prep_create_sql=/tmp/create.sql\"",
      "echo \"pilot_reply_template_prep_rollback_sql=/tmp/rollback.sql\"",
      "echo \"pilot_reply_template_prep_readiness=GO\"",
      "echo \"pilot_reply_template_prep_decision=$([[ " + prepareExitCode + " -eq 0 ]] && echo GO || echo NO_GO)\"",
      `exit ${prepareExitCode}`
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "inspect_pilot_candidate_profile.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo 'pilot_candidate_profile_inspection'",
      "echo 'profile_name=real-club-pilot'"
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "validate_pilot_candidate_profile.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo \"preflight_result=$([[ " + validateExitCode + " -eq 0 ]] && echo ok || echo failed)\"",
      `exit ${validateExitCode}`
    ].join("\n")
  );

  return repoRoot;
}

test("preflight from reply template confirms the local candidate gate in one pass", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_preflight_from_reply_template.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const replyTemplatePath = path.join(repoRoot, "tmp", "pilot-real-data-reply-template.txt");
  const outputRoot = path.join(repoRoot, "tmp", "preflight-output");

  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");
  fs.writeFileSync(replyTemplatePath, "Candidate identity\n- Candidate profile name: real-club-pilot\n");

  const output = execFileSync("bash", [scriptPath, onboardingPath, replyTemplatePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REPLY_TEMPLATE_PREFLIGHT_OUTPUT_DIR: outputRoot
    }
  });

  assert.match(output, /pilot_reply_template_preflight_decision=GO/);
  assert.match(output, /pilot_reply_template_preflight_candidate_profile=real-club-pilot/);
  assert.match(output, /pilot_reply_template_preflight_profile_preflight=ok/);
  assert.match(output, /pilot_reply_template_preflight_next_step=hosted_create_with_operator_present/);

  const bundlePath = output.match(/^pilot_reply_template_preflight_bundle=(.*)$/m)?.[1];
  assert.ok(bundlePath);
  assert.equal(fs.existsSync(path.join(bundlePath, "README.md")), true);
});

test("preflight from reply template stops when local profile validation fails", () => {
  const repoRoot = setupFixtureRepo({ validateExitCode: 1 });
  const scriptPath = path.join(repoRoot, "scripts", "pilot_preflight_from_reply_template.sh");
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
    assert.fail("expected preflight-from-reply-template to fail");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_reply_template_preflight_decision=NO_GO/);
  assert.match(output, /pilot_reply_template_preflight_profile_preflight=failed/);
  assert.match(output, /pilot_reply_template_preflight_next_step=review_summary_bundle/);
});
