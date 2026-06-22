import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-readiness-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const candidatesDir = path.join(repoRoot, "config", "pilot-candidates");
  const tmpDir = path.join(repoRoot, "tmp");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(candidatesDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const scriptName of [
    "pilot_real_candidate_readiness.sh",
    "load_pilot_candidate_env.sh",
    "validate_pilot_candidate_profile.sh"
  ]) {
    const sourcePath = path.resolve("scripts", scriptName);
    const targetPath = path.join(scriptsDir, scriptName);
    fs.copyFileSync(sourcePath, targetPath);
    fs.chmodSync(targetPath, 0o755);
  }

  return repoRoot;
}

function writeIntake(repoRoot, lines) {
  const intakePath = path.join(repoRoot, "docs", "pilot-real-candidate-intake.md");
  fs.writeFileSync(intakePath, lines.join("\n"));
}

function writeProfile(repoRoot, filename, lines) {
  const profilePath = path.join(repoRoot, "config", "pilot-candidates", filename);
  fs.writeFileSync(profilePath, lines.join("\n"));
}

test("real candidate readiness reports GO when all pre-creation artifacts are present", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_real_candidate_readiness.sh");
  const handoffPath = path.join(repoRoot, "tmp", "pilot-candidate-handoff.md");
  const creationBundleDir = path.join(
    repoRoot,
    "tmp",
    "pilot-candidate-create-plan",
    "20260621T010000Z-real-club"
  );

  writeIntake(repoRoot, [
    "# Pilot Real Candidate Intake",
    "",
    "- Candidate profile name: real-club",
    "- Organization name: Real Organization",
    "- Organization slug: real-org",
    "- Club name: Real Club",
    "- Club slug: real-club",
    "- Team name: U12 Blue",
    "- Team slug: u12-blue",
    "- Age group: U12",
    "- Submitter name: Avery Submitter",
    "- Submitter email: submitter@real-club.local",
    "- Organization admin name: Olivia Admin",
    "- Organization admin email: org-admin@real-club.local",
    "- Club admin name: Cameron Club Admin",
    "- Club admin email: club-admin@real-club.local",
    "- Club comms reviewer name: Riley Reviewer",
    "- Club comms reviewer email: reviewer@real-club.local",
    "- Team manager reviewer name: Taylor Manager",
    "- Team manager reviewer email: manager@real-club.local",
    "- Launch decision owner: Olivia Admin",
    "- Day-one operator: Cameron Club Admin",
    "- Rollback owner: Olivia Admin",
    "- Escalation contact: ops@real-club.local",
    "- Require real email delivery for launch: no",
    "- Require real push delivery for launch: no",
    "- Default approver role: club_comms",
    "- Public-content approver role: club_admin",
    "- Medium-risk approver role: team_manager",
    "- Allow Hermes agent routing: yes",
    "- Auto-approve low-risk internal content at organization level: yes",
    "- Auto-approve max risk threshold: 0.35",
    "- Allowed auto-approval content types: photo",
    "- Organization routing rule for video: club_admin",
    "- Should the club inherit org defaults unless explicitly noted: yes",
    "- Public-content second approval required: yes",
    "- Organization second approver role: club_admin",
    "- Organization second-approval content types: video",
    "- Organization notification default email: yes",
    "- Organization notification default push: yes",
    "- Notification posture on day one: log-only with manual review",
    "- Rollback trigger: wrong reviewers or routing behavior",
    "- First override to remove if day-one behavior is wrong: org default auto-approval",
    "- Scenarios to rerun after rollback: submit, approve, publish",
    "- Pilot-club communication owner: Cameron Club Admin"
  ]);

  writeProfile(repoRoot, "real-club.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=real-club",
    "PILOT_CANDIDATE=real_club",
    'PILOT_ORGANIZATION_NAME="Real Organization"',
    "PILOT_ORGANIZATION_SLUG=real-org",
    "ORGANIZATION_SLUG=real-org",
    'PILOT_CLUB_NAME="Real Club"',
    "PILOT_CLUB_SLUG=real-club",
    "CLUB_SLUG=real-club",
    'PILOT_TEAM_NAME="U12 Blue"',
    "PILOT_TEAM_SLUG=u12-blue",
    "TEAM_SLUG=u12-blue",
    "PILOT_AGE_GROUP=U12",
    'SUBMITTER_NAME="Avery Submitter"',
    "SUBMITTER_EMAIL=submitter@real-club.local",
    'ORGANIZATION_ADMIN_NAME="Olivia Admin"',
    "ORGANIZATION_ADMIN_EMAIL=org-admin@real-club.local",
    'CLUB_ADMIN_NAME="Cameron Club Admin"',
    "CLUB_ADMIN_EMAIL=club-admin@real-club.local",
    'REVIEWER_NAME="Riley Reviewer"',
    "REVIEWER_EMAIL=reviewer@real-club.local",
    'TEAM_MANAGER_REVIEWER_NAME="Taylor Manager"',
    "TEAM_MANAGER_REVIEWER_EMAIL=manager@real-club.local",
    'PRIMARY_REVIEWER_NAME="Taylor Manager"',
    "PRIMARY_REVIEWER_EMAIL=manager@real-club.local",
    'SECOND_REVIEWER_NAME="Cameron Club Admin"',
    "SECOND_REVIEWER_EMAIL=club-admin@real-club.local"
  ]);

  fs.writeFileSync(
    handoffPath,
    [
      "# Pilot Candidate Handoff Packet",
      "",
      "- Candidate profile: `real-club`",
      "- Decision: `GO`"
    ].join("\n")
  );

  fs.mkdirSync(creationBundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(creationBundleDir, "summary.txt"),
    [
      "pilot_candidate_creation_profile=real-club",
      "pilot_candidate_creation_decision=GO"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /check=intake_fields status=ok/);
  assert.match(output, /check=candidate_profile status=ok/);
  assert.match(output, /check=profile_preflight status=ok/);
  assert.match(output, /check=handoff_packet status=ok/);
  assert.match(output, /check=creation_plan status=ok/);
  assert.match(output, /pilot_real_candidate_readiness=GO/);
  assert.match(output, /pilot_real_candidate_next_step=review_sql_and_prepare_hosted_creation/);
});

test("real candidate readiness blocks early when intake fields are still missing", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_real_candidate_readiness.sh");

  writeIntake(repoRoot, [
    "# Pilot Real Candidate Intake",
    "",
    "- Candidate profile name: incomplete-club",
    "- Organization name: Incomplete Organization",
    "- Organization slug: incomplete-org"
  ]);

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.fail("expected readiness to fail when intake is incomplete");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /check=intake_fields status=missing/);
  assert.match(output, /pilot_real_candidate_readiness=NO_GO/);
  assert.match(output, /pilot_real_candidate_next_step=fill_intake/);
  assert.match(output, /missing_intake=club_name/);
  assert.equal(
    (output.match(/^missing_intake=require_email_delivery$/gm) || []).length,
    1
  );
  assert.equal(
    (output.match(/^missing_intake=require_push_delivery$/gm) || []).length,
    1
  );
  assert.equal(
    (output.match(/^missing_intake=inherit_org_defaults$/gm) || []).length,
    1
  );
  assert.equal(
    (output.match(/^missing_intake=public_second_approval$/gm) || []).length,
    1
  );
});

test("real candidate readiness also accepts the ready-to-paste key value block", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_real_candidate_readiness.sh");
  const intakePath = path.join(repoRoot, "docs", "pilot-real-candidate-intake.txt");
  const handoffPath = path.join(repoRoot, "tmp", "pilot-candidate-handoff.md");
  const creationBundleDir = path.join(
    repoRoot,
    "tmp",
    "pilot-candidate-create-plan",
    "20260621T010000Z-block-club"
  );

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
      "notification_posture=log-only with manual review",
      "rollback_trigger=wrong reviewers or routing behavior",
      "first_override=org default auto-approval",
      "rollback_scenarios=submit, approve, publish",
      "pilot_comms_owner=Cameron Club Admin"
    ].join("\n")
  );

  writeProfile(repoRoot, "block-club.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=block-club",
    "PILOT_CANDIDATE=block_club",
    'PILOT_ORGANIZATION_NAME="Block Organization"',
    "PILOT_ORGANIZATION_SLUG=block-org",
    "ORGANIZATION_SLUG=block-org",
    'PILOT_CLUB_NAME="Block Club"',
    "PILOT_CLUB_SLUG=block-club",
    "CLUB_SLUG=block-club",
    'PILOT_TEAM_NAME="U13 Gold"',
    "PILOT_TEAM_SLUG=u13-gold",
    "TEAM_SLUG=u13-gold",
    "PILOT_AGE_GROUP=U13",
    'SUBMITTER_NAME="Avery Submitter"',
    "SUBMITTER_EMAIL=submitter@block-club.local",
    'ORGANIZATION_ADMIN_NAME="Olivia Admin"',
    "ORGANIZATION_ADMIN_EMAIL=org-admin@block-club.local",
    'CLUB_ADMIN_NAME="Cameron Club Admin"',
    "CLUB_ADMIN_EMAIL=club-admin@block-club.local",
    'REVIEWER_NAME="Riley Reviewer"',
    "REVIEWER_EMAIL=reviewer@block-club.local",
    'TEAM_MANAGER_REVIEWER_NAME="Taylor Manager"',
    "TEAM_MANAGER_REVIEWER_EMAIL=manager@block-club.local",
    'PRIMARY_REVIEWER_NAME="Taylor Manager"',
    "PRIMARY_REVIEWER_EMAIL=manager@block-club.local",
    'SECOND_REVIEWER_NAME="Cameron Club Admin"',
    "SECOND_REVIEWER_EMAIL=club-admin@block-club.local"
  ]);

  fs.writeFileSync(
    handoffPath,
    [
      "# Pilot Candidate Handoff Packet",
      "",
      "- Candidate profile: `block-club`",
      "- Decision: `GO`"
    ].join("\n")
  );

  fs.mkdirSync(creationBundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(creationBundleDir, "summary.txt"),
    [
      "pilot_candidate_creation_profile=block-club",
      "pilot_candidate_creation_decision=GO"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, intakePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /check=intake_format status=ok detail=key_value_block/);
  assert.match(output, /pilot_real_candidate_readiness=GO/);
});
