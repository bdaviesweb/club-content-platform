import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-prepare-"));

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
        name: "pilot-prepare-fixture",
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

test("prepare from intake creates all pre-creation artifacts from one intake file", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_prepare_from_intake.sh");
  const intakePath = path.join(repoRoot, "docs", "pilot-real-candidate-intake.txt");
  const handoffPath = path.join(repoRoot, "tmp", "pilot-candidate-handoff.md");
  const demoDir = path.join(repoRoot, "tmp", "pilot-demo", "20260621T010000Z-simulated");
  const rehearsalDir = path.join(repoRoot, "tmp", "pilot-rehearsal", "20260621T020000Z-simulated");

  fs.writeFileSync(
    intakePath,
    [
      "candidate_profile_name=block-club",
      "organization_name=Block Organization",
      "organization_slug=block-org",
      "club_name=Block Club",
      "club_slug=block-club",
      "team_name=U13 Gold",
      "team_slug=u13-gold",
      "age_group=U13",
      "",
      "submitter_name=Avery Submitter",
      "submitter_email=submitter@block-club.local",
      "",
      "organization_admin_name=Olivia Admin",
      "organization_admin_email=org-admin@block-club.local",
      "",
      "club_admin_name=Cameron Club Admin",
      "club_admin_email=club-admin@block-club.local",
      "",
      "reviewer_name=Riley Reviewer",
      "reviewer_email=reviewer@block-club.local",
      "",
      "team_manager_name=Taylor Manager",
      "team_manager_email=manager@block-club.local",
      "",
      "launch_decision_owner=Olivia Admin",
      "day_one_operator=Cameron Club Admin",
      "rollback_owner=Olivia Admin",
      "escalation_contact=ops@block-club.local",
      "",
      "require_email_delivery=no",
      "require_push_delivery=no",
      "default_approver_role=club_comms",
      "public_content_approver_role=club_admin",
      "medium_risk_approver_role=team_manager",
      "allow_agent_routing=yes",
      "auto_approve_internal_low_risk=yes",
      "auto_approve_max_risk=0.35",
      "auto_approval_content_types=photo",
      "routing_video_approver_role=club_admin",
      "inherit_org_defaults=yes",
      "public_second_approval=yes",
      "second_approver_role=club_admin",
      "second_approval_content_types=video",
      "org_notification_email=yes",
      "org_notification_push=yes",
      "club_auto_approve_internal_low_risk=no",
      "club_routing_video_approver_role=team_manager",
      "club_public_second_approval=no",
      "club_notification_email=no",
      "club_notification_push=no",
      "notification_posture=log-only with manual review",
      "rollback_trigger=wrong reviewers or routing behavior",
      "first_override=org default auto-approval",
      "rollback_scenarios=submit, approve, publish",
      "pilot_comms_owner=Cameron Club Admin"
    ].join("\n")
  );

  fs.mkdirSync(demoDir, { recursive: true });
  fs.mkdirSync(rehearsalDir, { recursive: true });
  fs.writeFileSync(path.join(demoDir, "summary.txt"), "demo=ok\n");
  fs.writeFileSync(path.join(rehearsalDir, "summary.txt"), "pilot_rehearsal_decision=GO\n");

  const output = execFileSync("bash", [scriptPath, intakePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_CANDIDATE_HANDOFF_PACKET_PATH: handoffPath,
      PILOT_DEMO_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-demo"),
      PILOT_REHEARSAL_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-rehearsal"),
      PILOT_CANDIDATE_CREATION_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-candidate-create-plan")
    }
  });

  assert.match(output, /created_profile=.*block-club\.local\.env/);
  assert.match(output, /pilot_candidate_handoff_decision=GO/);
  assert.match(output, /pilot_candidate_creation_decision=GO/);
  assert.match(output, /pilot_real_candidate_readiness=GO/);
  assert.match(output, /pilot_prepare_profile=block-club/);
  assert.match(output, /pilot_prepare_readiness=GO/);

  assert.equal(fs.existsSync(path.join(repoRoot, "config", "pilot-candidates", "block-club.local.env")), true);
  assert.equal(fs.existsSync(handoffPath), true);

  const creationRoot = path.join(repoRoot, "tmp", "pilot-candidate-create-plan");
  const bundleName = fs.readdirSync(creationRoot, { withFileTypes: true }).find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName);
  assert.equal(fs.existsSync(path.join(creationRoot, bundleName, "create.sql")), true);
  assert.equal(fs.existsSync(path.join(creationRoot, bundleName, "rollback.sql")), true);

  const profile = fs.readFileSync(
    path.join(repoRoot, "config", "pilot-candidates", "block-club.local.env"),
    "utf8"
  );
  assert.match(profile, /PILOT_ORG_AUTO_APPROVE_MAX_RISK=0\.35/);
  assert.match(profile, /PILOT_CLUB_OVERRIDE_ROUTING_VIDEO_APPROVER_ROLE=team_manager/);

  const createSql = fs.readFileSync(path.join(creationRoot, bundleName, "create.sql"), "utf8");
  assert.match(createSql, /INSERT INTO organization_workflow_policies/);
  assert.match(createSql, /INSERT INTO club_workflow_policies/);
});
