import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-prepare-reply-template-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeExecutable(pathname, contents) {
  fs.writeFileSync(pathname, contents);
  fs.chmodSync(pathname, 0o755);
}

function setupFixtureRepo({ processExitCode = 0, prepareExitCode = 0 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_prepare_from_reply_template.sh");
  const targetPath = path.join(scriptsDir, "pilot_prepare_from_reply_template.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  writeExecutable(
    path.join(scriptsDir, "pilot_process_reply_template.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "applied_dir=\"$(dirname \"$1\")/applied\"",
      "mkdir -p \"$applied_dir\"",
      "applied_path=\"$applied_dir/pilot-onboarding.applied.md\"",
      "cp \"$1\" \"$applied_path\"",
      "echo \"pilot_reply_template_process_applied_onboarding=$applied_path\"",
      "echo \"pilot_reply_template_process_bundle=/tmp/process-bundle\"",
      "echo \"pilot_reply_template_process_decision=$([[ " + processExitCode + " -eq 0 ]] && echo GO || echo NO_GO)\"",
      `exit ${processExitCode}`
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_prepare_from_onboarding.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo \"pilot_prepare_profile=real-club-pilot\"",
      "echo \"pilot_prepare_profile_path=/tmp/real-club-pilot.local.env\"",
      "echo \"pilot_prepare_creation_plan=/tmp/creation-plan.md\"",
      "echo \"pilot_prepare_create_sql=/tmp/create.sql\"",
      "echo \"pilot_prepare_rollback_sql=/tmp/rollback.sql\"",
      "echo \"pilot_prepare_readiness=GO\"",
      "echo \"pilot_prepare_onboarding_intake=/tmp/candidate-intake.txt\"",
      `exit ${prepareExitCode}`
    ].join("\n")
  );

  return repoRoot;
}

test("prepare from reply template processes the returned answers and generates pre-creation artifacts", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_prepare_from_reply_template.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const replyTemplatePath = path.join(repoRoot, "tmp", "pilot-real-data-reply-template.txt");
  const outputRoot = path.join(repoRoot, "tmp", "prep-output");

  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");
  fs.writeFileSync(replyTemplatePath, "Candidate identity\n- Candidate profile name: real-club-pilot\n");

  const output = execFileSync("bash", [scriptPath, onboardingPath, replyTemplatePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REPLY_TEMPLATE_PREP_OUTPUT_DIR: outputRoot
    }
  });

  assert.match(output, /pilot_reply_template_prep_decision=GO/);
  assert.match(output, /pilot_reply_template_prep_candidate_profile=real-club-pilot/);
  assert.match(output, /pilot_reply_template_prep_process_bundle=\/tmp\/process-bundle/);
  assert.match(output, /pilot_reply_template_prep_creation_plan=\/tmp\/creation-plan.md/);
  assert.match(output, /pilot_reply_template_prep_next_step=inspect_candidate_profile/);

  const bundlePath = output.match(/^pilot_reply_template_prep_bundle=(.*)$/m)?.[1];
  assert.ok(bundlePath);
  assert.equal(fs.existsSync(path.join(bundlePath, "README.md")), true);
});

test("prepare from reply template stops when reply-template processing is still incomplete", () => {
  const repoRoot = setupFixtureRepo({ processExitCode: 1 });
  const scriptPath = path.join(repoRoot, "scripts", "pilot_prepare_from_reply_template.sh");
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
    assert.fail("expected prepare-from-reply-template to fail");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_reply_template_prep_decision=NO_GO/);
  assert.match(output, /pilot_reply_template_prep_next_step=review_summary_bundle/);
});
