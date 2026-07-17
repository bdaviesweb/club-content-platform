import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-intake-"));

test.after(() => {
  fs.rmSync(fixtureRepo, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRepo, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const candidatesDir = path.join(repoRoot, "config", "pilot-candidates");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(candidatesDir, { recursive: true });

  const sourceScript = path.resolve("scripts/pilot_candidate_profile_from_intake.sh");
  fs.copyFileSync(sourceScript, path.join(scriptsDir, "pilot_candidate_profile_from_intake.sh"));
  fs.chmodSync(path.join(scriptsDir, "pilot_candidate_profile_from_intake.sh"), 0o755);

  return repoRoot;
}

test("pilot candidate intake script creates a local env profile from a filled intake", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_candidate_profile_from_intake.sh");
  const intakePath = path.join(repoRoot, "docs", "pilot-real-candidate-intake.md");

  fs.writeFileSync(
    intakePath,
    [
      "# Pilot Real Candidate Intake",
      "",
      "- Candidate profile name: real-club",
      "- Organization name: Real Organization",
      "- Organization slug: real-organization",
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
      "- Team manager reviewer email: manager@real-club.local"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, intakePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const createdPath = path.join(repoRoot, "config", "pilot-candidates", "real-club.local.env");
  assert.equal(fs.existsSync(createdPath), true);
  const created = fs.readFileSync(createdPath, "utf8");
  assert.match(created, /PILOT_CANDIDATE_PROFILE_NAME=real-club/);
  assert.match(created, /PILOT_ORGANIZATION_SLUG=real-organization/);
  assert.match(created, /PILOT_AGE_GROUP=U12/);
  assert.match(created, /SUBMITTER_NAME="Avery Submitter"/);
  assert.match(created, /PRIMARY_REVIEWER_EMAIL=manager@real-club\.local/);
  assert.match(created, /SECOND_REVIEWER_EMAIL=club-admin@real-club\.local/);
  assert.match(output, /created_profile=.*real-club\.local\.env/);
  assert.match(output, /handoff_packet_command=npm run pilot:handoff-packet -- real-club/);
  assert.match(output, /creation_plan_command=npm run pilot:create-plan -- real-club/);
});

test("pilot candidate intake script rejects incomplete intake files", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_candidate_profile_from_intake.sh");
  const intakePath = path.join(repoRoot, "docs", "pilot-real-candidate-intake.md");

  fs.writeFileSync(
    intakePath,
    [
      "# Pilot Real Candidate Intake",
      "",
      "- Candidate profile name: incomplete-club",
      "- Organization name: Incomplete Organization"
    ].join("\n")
  );

  assert.throws(
    () =>
      execFileSync("bash", [scriptPath, intakePath], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }),
    /missing required fields/i
  );
});

test("pilot candidate intake script also accepts the ready-to-paste key value block", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_candidate_profile_from_intake.sh");
  const intakePath = path.join(repoRoot, "docs", "pilot-real-candidate-intake.txt");

  fs.writeFileSync(
    intakePath,
    [
      "candidate_profile_name=block-club",
      "organization_name=Block Organization",
      "organization_slug=block-organization",
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
      "team_manager_email=manager@block-club.local"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, intakePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const createdPath = path.join(repoRoot, "config", "pilot-candidates", "block-club.local.env");
  assert.equal(fs.existsSync(createdPath), true);
  const created = fs.readFileSync(createdPath, "utf8");
  assert.match(created, /PILOT_CANDIDATE_PROFILE_NAME=block-club/);
  assert.match(created, /PILOT_TEAM_SLUG=u13-gold/);
  assert.match(created, /REVIEWER_EMAIL=reviewer@block-club\.local/);
  assert.match(output, /source_format=key_value_block/);
});
