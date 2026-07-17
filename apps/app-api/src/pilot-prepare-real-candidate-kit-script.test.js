import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-prepare-real-kit-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function copyScript(repoRoot, scriptName) {
  const sourcePath = path.resolve("scripts", scriptName);
  const targetPath = path.join(repoRoot, "scripts", scriptName);
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);
}

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "tmp"), { recursive: true });

  for (const scriptName of [
    "pilot_prepare_real_candidate_kit.sh",
    "pilot_scaffold_real_onboarding.sh",
    "pilot_real_onboarding_gaps.sh",
    "pilot_real_data_request_packet.sh",
    "pilot_share_real_data_request.sh",
    "pilot_validate_onboarding.sh",
    "pilot_check_launch_readiness.sh"
  ]) {
    copyScript(repoRoot, scriptName);
  }

  return repoRoot;
}

test("prepare real candidate kit bundles the scaffold, gap report, request packet, and share message", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_prepare_real_candidate_kit.sh");
  const sourceOnboardingPath = path.join(repoRoot, "docs", "pilot-onboarding-source.md");
  const outputRoot = path.join(repoRoot, "tmp", "kit-output");

  fs.writeFileSync(
    sourceOnboardingPath,
    [
      "# Pilot Club Onboarding: North River Youth Sports",
      "",
      "## Workflow Policy Decisions",
      "",
      "- Default approver role: `team_manager`",
      "- Public-content approver role: `club_comms`",
      "- Medium-risk approver role: `club_comms`",
      "- Allow Hermes agent routing: `yes`",
      "- Auto-approve low-risk internal content at organization level: `yes`",
      "- Auto-approve low-risk internal content at club effective level: `no`",
      "- Auto-approve max risk threshold: `0.35`",
      "- Allowed auto-approval content types: `photo`",
      "- Should the club inherit org defaults unless explicitly noted: `yes`",
      "",
      "## Approval and Publishing Rules",
      "",
      "- Organization routing rule for `video`: `club_admin`",
      "- Club effective routing rule for `video`: `team_manager`",
      "- Organization public-content second approval: `yes`",
      "- Organization second approver role: `club_admin`",
      "- Organization second-approval content types: `video`",
      "- Club effective public-content second approval: `no`",
      "- Internal destinations: `internal_feed`",
      "- Public destinations: `internal_feed`",
      "",
      "## Notification Decisions",
      "",
      "- Organization notification default: `email=true`, `push=true`",
      "- Club effective notification baseline: `email=false`, `push=false`"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, sourceOnboardingPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REAL_CANDIDATE_KIT_OUTPUT_DIR: outputRoot
    }
  });

  assert.match(output, /pilot_real_candidate_kit_bundle=/);
  assert.match(output, /pilot_real_candidate_kit_gap_count=/);
  assert.match(output, /pilot_real_candidate_kit_status=needs_input/);

  const bundlePath = output.match(/^pilot_real_candidate_kit_bundle=(.*)$/m)?.[1];
  assert.ok(bundlePath);

  assert.equal(fs.existsSync(path.join(bundlePath, "pilot-onboarding-real-candidate.md")), true);
  assert.equal(fs.existsSync(path.join(bundlePath, "onboarding-gaps.txt")), true);
  assert.equal(fs.existsSync(path.join(bundlePath, "pilot-real-data-request.md")), true);
  assert.equal(fs.existsSync(path.join(bundlePath, "pilot-real-data-request-message.txt")), true);
  assert.equal(fs.existsSync(path.join(bundlePath, "pilot-real-data-reply-template.txt")), true);
  assert.equal(fs.existsSync(path.join(bundlePath, "README.md")), true);

  const readme = fs.readFileSync(path.join(bundlePath, "README.md"), "utf8");
  assert.match(readme, /# Real Candidate Prep Kit/);
  assert.match(readme, /How To Use/);
  const replyTemplate = fs.readFileSync(path.join(bundlePath, "pilot-real-data-reply-template.txt"), "utf8");
  assert.match(replyTemplate, /Candidate identity/);
  assert.match(replyTemplate, /- Candidate profile name:/);
  assert.match(replyTemplate, /Live launch gate/);
});
