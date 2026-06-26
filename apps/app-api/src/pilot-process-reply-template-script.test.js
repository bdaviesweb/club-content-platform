import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-process-reply-template-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeExecutable(pathname, contents) {
  fs.writeFileSync(pathname, contents);
  fs.chmodSync(pathname, 0o755);
}

function setupFixtureRepo({ validateExitCode = 0, gapsExitCode = 0, readinessExitCode = 0 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_process_reply_template.sh");
  const targetPath = path.join(scriptsDir, "pilot_process_reply_template.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  writeExecutable(
    path.join(scriptsDir, "pilot_apply_reply_template.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "cp \"$1\" \"$3\"",
      "printf '%s\\n' '- Candidate profile name: applied-from-template' >> \"$3\"",
      "echo 'pilot_reply_template_next_step=validate_onboarding'"
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_validate_onboarding.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `echo "pilot_onboarding_validation=$([[ ${validateExitCode} -eq 0 ]] && echo GO || echo NO_GO)"`,
      `exit ${validateExitCode}`
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_real_onboarding_gaps.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `echo "pilot_real_onboarding_gaps=$([[ ${gapsExitCode} -eq 0 ]] && echo GO || echo NO_GO)"`,
      `echo "pilot_real_onboarding_gap_count=$([[ ${gapsExitCode} -eq 0 ]] && echo 0 || echo 3)"`,
      `exit ${gapsExitCode}`
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_check_launch_readiness.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `echo "pilot_launch_readiness=$([[ ${readinessExitCode} -eq 0 ]] && echo GO || echo NO_GO)"`,
      `exit ${readinessExitCode}`
    ].join("\n")
  );

  return repoRoot;
}

test("processing a filled reply template creates an applied worksheet bundle and returns GO when checks pass", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_process_reply_template.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const replyTemplatePath = path.join(repoRoot, "tmp", "pilot-real-data-reply-template.txt");
  const outputRoot = path.join(repoRoot, "tmp", "process-output");

  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");
  fs.writeFileSync(replyTemplatePath, "Candidate identity\n- Candidate profile name: real-club-pilot\n");

  const output = execFileSync("bash", [scriptPath, onboardingPath, replyTemplatePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REPLY_TEMPLATE_OUTPUT_DIR: outputRoot
    }
  });

  assert.match(output, /pilot_reply_template_process_decision=GO/);
  assert.match(output, /pilot_reply_template_process_validation=GO/);
  assert.match(output, /pilot_reply_template_process_gap_result=GO/);
  assert.match(output, /pilot_reply_template_process_readiness=GO/);
  assert.match(output, /pilot_reply_template_process_next_step=prepare_from_onboarding/);

  const bundlePath = output.match(/^pilot_reply_template_process_bundle=(.*)$/m)?.[1];
  assert.ok(bundlePath);
  assert.equal(fs.existsSync(path.join(bundlePath, "pilot-onboarding.applied.md")), true);
  assert.equal(fs.existsSync(path.join(bundlePath, "README.md")), true);
});

test("processing a reply template returns NO_GO and preserves logs when readiness is still incomplete", () => {
  const repoRoot = setupFixtureRepo({ readinessExitCode: 1 });
  const scriptPath = path.join(repoRoot, "scripts", "pilot_process_reply_template.sh");
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
    assert.fail("expected processing to fail when launch readiness is incomplete");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_reply_template_process_decision=NO_GO/);
  assert.match(output, /pilot_reply_template_process_readiness=NO_GO/);
  assert.match(output, /pilot_reply_template_process_next_step=review_summary_bundle/);
});
