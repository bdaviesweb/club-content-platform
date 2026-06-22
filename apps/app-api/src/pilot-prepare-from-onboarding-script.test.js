import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-prepare-onboarding-"));

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
  fs.mkdirSync(path.join(repoRoot, "config", "pilot-candidates"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "tmp"), { recursive: true });

  for (const scriptName of [
    "pilot_prepare_from_onboarding.sh",
    "pilot_onboarding_to_intake.sh",
    "pilot_prepare_from_intake.sh",
    "pilot_candidate_profile_from_intake.sh",
    "pilot_candidate_handoff_packet.sh",
    "pilot_candidate_creation_plan.sh",
    "pilot_real_candidate_readiness.sh",
    "inspect_pilot_candidate_profile.sh",
    "load_pilot_candidate_env.sh",
    "validate_pilot_candidate_profile.sh"
  ]) {
    copyScript(repoRoot, scriptName);
  }

  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        name: "pilot-prepare-onboarding-fixture",
        private: true,
        scripts: {
          "pilot:inspect": "bash scripts/inspect_pilot_candidate_profile.sh"
        }
      },
      null,
      2
    )
  );

  return repoRoot;
}

test("prepare from onboarding converts the worksheet and creates all pre-creation artifacts", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_prepare_from_onboarding.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const intakeOutputPath = path.join(repoRoot, "tmp", "candidate-intake.txt");
  const handoffPath = path.join(repoRoot, "tmp", "pilot-candidate-handoff.md");
  const demoDir = path.join(repoRoot, "tmp", "pilot-demo", "20260621T010000Z-simulated");
  const rehearsalDir = path.join(repoRoot, "tmp", "pilot-rehearsal", "20260621T020000Z-simulated");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Block Club",
      "",
      "## Club Identity",
      "",
      "- Candidate profile name: block-club-pilot",
      "- Organization name: `Block Organization`",
      "- Organization slug: `block-org`",
      "- Club name: `Block Club`",
      "- Club slug: `block-club`",
      "- Team names and slugs: `U13 Gold` / `u13-gold`",
      "- Age group: `U13`",
      "",
      "## People and Roles",
      "",
      "- Launch decision owner: `Olivia Admin`",
      "- Day-one operator: `Cameron Club Admin`",
      "- Escalation contact: `Ops Team` <`ops@block-club.local`>",
      "- Submitter name and email: `Avery Submitter` <`submitter@block-club.local`>",
      "- Organization admin name and email: `Olivia Admin` <`org-admin@block-club.local`>",
      "- Club admin name and email: `Cameron Club Admin` <`club-admin@block-club.local`>",
      "- Club comms reviewer name and email: `Riley Reviewer` <`reviewer@block-club.local`>",
      "- Team manager reviewer name and email: `Taylor Manager` <`manager@block-club.local`>",
      "",
      "## Workflow Policy Decisions",
      "",
      "- Default approver role: `club_comms`",
      "- Public-content approver role: `club_admin`",
      "- Medium-risk approver role: `team_manager`",
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
      "- Organization public-content second approval: `yes`",
      "- Organization second approver role: `club_admin`",
      "- Organization second-approval content types: `video`",
      "- Club effective routing rule for `video`: `team_manager`",
      "- Club effective public-content second approval: `no`",
      "",
      "## Notification Decisions",
      "",
      "- Require real email delivery for launch: `no`",
      "- Require real push delivery for launch: `no`",
      "- Organization notification default: `email=true`, `push=true`",
      "- Club effective notification baseline: `email=false`, `push=false`",
      "- Notification posture on day one: `log-only with manual review`",
      "",
      "## Rollback Plan",
      "",
      "- Rollback owner: `Olivia Admin`",
      "- Rollback trigger: `wrong reviewers or routing behavior`",
      "- First override to remove if pilot behavior is wrong: `org default auto-approval`",
      "- Scenarios to rerun after rollback: `submit, approve, publish`",
      "- Pilot-club communication owner: `Cameron Club Admin`"
    ].join("\n")
  );

  fs.mkdirSync(demoDir, { recursive: true });
  fs.mkdirSync(rehearsalDir, { recursive: true });
  fs.writeFileSync(path.join(demoDir, "summary.txt"), "demo=ok\n");
  fs.writeFileSync(path.join(rehearsalDir, "summary.txt"), "pilot_rehearsal_decision=GO\n");

  const output = execFileSync("bash", [scriptPath, onboardingPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REAL_CANDIDATE_INTAKE_OUTPUT_PATH: intakeOutputPath,
      PILOT_CANDIDATE_HANDOFF_PACKET_PATH: handoffPath,
      PILOT_DEMO_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-demo"),
      PILOT_REHEARSAL_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-rehearsal"),
      PILOT_CANDIDATE_CREATION_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-candidate-create-plan")
    }
  });

  assert.match(output, /pilot_prepare_onboarding=.*pilot-onboarding\.md/);
  assert.match(output, /pilot_prepare_onboarding_intake=.*candidate-intake\.txt/);
  assert.match(output, /pilot_prepare_profile=block-club-pilot/);
  assert.match(output, /pilot_prepare_readiness=GO/);

  const intakeBlock = fs.readFileSync(intakeOutputPath, "utf8");
  assert.match(intakeBlock, /^candidate_profile_name=block-club-pilot$/m);
  assert.match(intakeBlock, /^require_email_delivery=no$/m);

  const profilePath = path.join(repoRoot, "config", "pilot-candidates", "block-club-pilot.local.env");
  assert.equal(fs.existsSync(profilePath), true);
});
