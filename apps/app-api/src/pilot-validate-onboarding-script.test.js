import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-validate-onboarding-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_validate_onboarding.sh");
  const targetPath = path.join(scriptsDir, "pilot_validate_onboarding.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  return repoRoot;
}

test("pilot onboarding validator accepts a fully filled worksheet", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_validate_onboarding.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Block Club",
      "",
      "## Club Identity",
      "",
      "- Candidate profile name: block-club-pilot",
      "- Organization name: Block Organization",
      "- Organization slug: block-org",
      "- Club name: Block Club",
      "- Club slug: block-club",
      "- Team names and slugs: U13 Gold / u13-gold",
      "- Age group: U13",
      "",
      "## People and Roles",
      "",
      "- Launch decision owner: Olivia Admin",
      "- Day-one operator: Cameron Club Admin",
      "- Escalation contact: Ops Team <ops@block-club.local>",
      "- Submitter name and email: Avery Submitter <submitter@block-club.local>",
      "- Organization admin name and email: Olivia Admin <org-admin@block-club.local>",
      "- Club admin name and email: Cameron Club Admin <club-admin@block-club.local>",
      "- Club comms reviewer name and email: Riley Reviewer <reviewer@block-club.local>",
      "- Team manager reviewer name and email: Taylor Manager <manager@block-club.local>",
      "",
      "## Workflow Policy Decisions",
      "",
      "- Default approver role: club_comms",
      "- Public-content approver role: club_admin",
      "- Medium-risk approver role: team_manager",
      "- Allow Hermes agent routing: yes",
      "- Auto-approve low-risk internal content at organization level: yes",
      "- Auto-approve low-risk internal content at club effective level: no",
      "- Auto-approve max risk threshold: 0.35",
      "- Allowed auto-approval content types: photo",
      "- Should the club inherit org defaults unless explicitly noted: yes",
      "",
      "## Approval and Publishing Rules",
      "",
      "- Organization routing rule for `video`: club_admin",
      "- Club effective routing rule for `video`: team_manager",
      "- Organization public-content second approval: yes",
      "- Organization second approver role: club_admin",
      "- Organization second-approval content types: video",
      "- Club effective public-content second approval: no",
      "",
      "## Notification Decisions",
      "",
      "- Require real email delivery for launch: no",
      "- Require real push delivery for launch: no",
      "- Organization notification default: email=true, push=true",
      "- Club effective notification baseline: email=false, push=false",
      "- Notification posture on day one: log-only with manual review",
      "",
      "## Rollback Plan",
      "",
      "- Rollback owner: Olivia Admin",
      "- Rollback trigger: wrong reviewers or routing behavior",
      "- First override to remove if pilot behavior is wrong: org default auto-approval",
      "- Scenarios to rerun after rollback: submit, approve, publish",
      "- Pilot-club communication owner: Cameron Club Admin"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, onboardingPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /check=onboarding_fields status=ok/);
  assert.match(output, /pilot_onboarding_validation=GO/);
});

test("pilot onboarding validator blocks when required fields are missing", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_validate_onboarding.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Incomplete Club",
      "",
      "## Club Identity",
      "",
      "- Organization name: Incomplete Organization",
      "- Organization slug: incomplete-org"
    ].join("\n")
  );

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath, onboardingPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.fail("expected onboarding validation to fail");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_onboarding_validation=NO_GO/);
  assert.match(output, /pilot_onboarding_next_step=fill_onboarding/);
  assert.match(output, /missing_onboarding=candidate_profile_name/);
  assert.match(output, /missing_onboarding=require_email_delivery/);
});
