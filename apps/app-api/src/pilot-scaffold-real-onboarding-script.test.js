import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-scaffold-onboarding-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_scaffold_real_onboarding.sh");
  const targetPath = path.join(scriptsDir, "pilot_scaffold_real_onboarding.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  return repoRoot;
}

test("real onboarding scaffold carries forward validated policy defaults and blanks real identities", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_scaffold_real_onboarding.sh");
  const sourceOnboardingPath = path.join(repoRoot, "docs", "pilot-onboarding-source.md");
  const outputOnboardingPath = path.join(repoRoot, "tmp", "pilot-onboarding-real.md");

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

  const output = execFileSync("bash", [scriptPath, sourceOnboardingPath, outputOnboardingPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_scaffold_source_onboarding=.*pilot-onboarding-source\.md/);
  assert.match(output, /pilot_scaffold_output_onboarding=.*pilot-onboarding-real\.md/);
  assert.match(output, /pilot_scaffold_next_step=fill_real_fields/);

  const scaffolded = fs.readFileSync(outputOnboardingPath, "utf8");
  assert.match(scaffolded, /- Candidate profile name:\s*$/m);
  assert.match(scaffolded, /- Organization name:\s*$/m);
  assert.match(scaffolded, /- Default approver role: `team_manager`| - Default approver role: team_manager/m);
  assert.match(scaffolded, /- Organization routing rule for `video`: `club_admin`| - Organization routing rule for `video`: club_admin/m);
  assert.match(scaffolded, /- Organization notification default: `email=true`, `push=true`| - Organization notification default: email=true, push=true/m);
  assert.match(scaffolded, /- Source simulator packet: `.*pilot-onboarding-source\.md`/);
});
