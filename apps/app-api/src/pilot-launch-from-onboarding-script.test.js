import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-launch-onboarding-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeExecutable(pathname, contents) {
  fs.writeFileSync(pathname, contents);
  fs.chmodSync(pathname, 0o755);
}

function setupFixtureRepo({ readinessExitCode = 0, verifyExitCode = 0 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_launch_from_onboarding.sh");
  const targetPath = path.join(scriptsDir, "pilot_launch_from_onboarding.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  writeExecutable(
    path.join(scriptsDir, "pilot_validate_onboarding.sh"),
    "#!/usr/bin/env bash\nset -euo pipefail\necho \"pilot_onboarding_validation=GO\"\n"
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
      "echo \"pilot_prepare_readiness=GO\""
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_check_launch_readiness.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `echo "pilot_launch_readiness=$([[ ${readinessExitCode} -eq 0 ]] && echo GO || echo NO_GO)"`,
      `echo "pilot_launch_readiness_next_step=$([[ ${readinessExitCode} -eq 0 ]] && echo apply_create_sql || echo finish_prelaunch_checklist)"`,
      `exit ${readinessExitCode}`
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_apply_candidate_sql.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "mode=\"${2}\"",
      "echo \"pilot_sql_apply_bundle_path=/tmp/${mode}-bundle\"",
      "echo \"pilot_sql_apply_decision=GO\""
    ].join("\n")
  );

  writeExecutable(
    path.join(scriptsDir, "pilot_post_creation_verify.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo \"pilot_post_creation_bundle_path=/tmp/post-create-bundle\"",
      `echo "pilot_post_creation_decision=$([[ ${verifyExitCode} -eq 0 ]] && echo GO || echo NO_GO)"`,
      `exit ${verifyExitCode}`
    ].join("\n")
  );

  return repoRoot;
}

test("pilot launch from onboarding orchestrates prepare, create, and verify", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_launch_from_onboarding.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");

  const output = execFileSync("bash", [scriptPath, onboardingPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_real_launch_profile=real-club-pilot/);
  assert.match(output, /pilot_real_launch_create_bundle=\/tmp\/create-bundle/);
  assert.match(output, /pilot_real_launch_verify_bundle=\/tmp\/post-create-bundle/);
  assert.match(output, /pilot_real_launch_rollback_command=PILOT_CANDIDATE_PROFILE=real-club-pilot npm run pilot:apply-sql -- real-club-pilot rollback/);
  assert.match(output, /pilot_real_launch_decision=GO/);
});

test("pilot launch from onboarding can auto-rollback after failed verification", () => {
  const repoRoot = setupFixtureRepo({ verifyExitCode: 1 });
  const scriptPath = path.join(repoRoot, "scripts", "pilot_launch_from_onboarding.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath, onboardingPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AUTO_ROLLBACK_ON_VERIFY_FAIL: "1"
      }
    });
    assert.fail("expected launch from onboarding to fail when verification fails");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_real_launch_decision=NO_GO/);
  assert.match(output, /pilot_real_launch_rollback_bundle=\/tmp\/rollback-bundle/);
});

test("pilot launch from onboarding stops before hosted create when prelaunch readiness is not recorded", () => {
  const repoRoot = setupFixtureRepo({ readinessExitCode: 1 });
  const scriptPath = path.join(repoRoot, "scripts", "pilot_launch_from_onboarding.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  fs.writeFileSync(onboardingPath, "# Pilot Club Onboarding: Real Club\n");

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath, onboardingPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.fail("expected launch from onboarding to fail when launch readiness is missing");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_real_launch_decision=NO_GO/);
  assert.match(output, /pilot_launch_readiness=NO_GO/);
  assert.doesNotMatch(output, /pilot_real_launch_create_bundle=\/tmp\/create-bundle/);
});
