import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_candidate_creation_plan.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-creation-plan-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeProfile(filename, lines) {
  const profilePath = path.join(tempRoot, filename);
  fs.writeFileSync(profilePath, lines.join("\n"));
  return profilePath;
}

test("pilot candidate creation plan generates create and rollback SQL for a complete profile", () => {
  const profilePath = writeProfile("candidate.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=real-candidate",
    'PILOT_ORGANIZATION_NAME="Real Organization"',
    "PILOT_ORGANIZATION_SLUG=real-org",
    "ORGANIZATION_SLUG=real-org",
    'PILOT_CLUB_NAME="Real Club"',
    "PILOT_CLUB_SLUG=real-club",
    "CLUB_SLUG=real-club",
    'PILOT_TEAM_NAME="Real Team"',
    "PILOT_TEAM_SLUG=real-team",
    "TEAM_SLUG=real-team",
    "PILOT_AGE_GROUP=U12",
    'SUBMITTER_NAME="Real Submitter"',
    "SUBMITTER_EMAIL=submitter@real.local",
    'ORGANIZATION_ADMIN_NAME="Real Org Admin"',
    "ORGANIZATION_ADMIN_EMAIL=org-admin@real.local",
    'CLUB_ADMIN_NAME="Real Club Admin"',
    "CLUB_ADMIN_EMAIL=club-admin@real.local",
    'REVIEWER_NAME="Real Reviewer"',
    "REVIEWER_EMAIL=reviewer@real.local",
    'TEAM_MANAGER_REVIEWER_NAME="Real Team Manager"',
    "TEAM_MANAGER_REVIEWER_EMAIL=manager@real.local"
  ]);
  const outputDir = path.join(tempRoot, "output");

  const output = execFileSync("bash", [scriptPath, profilePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_CANDIDATE_CREATION_OUTPUT_DIR: outputDir
    }
  });

  assert.match(output, /pilot_candidate_creation_decision=GO/);
  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName);
  const bundleDir = path.join(outputDir, bundleName);
  const plan = fs.readFileSync(path.join(bundleDir, "creation-plan.md"), "utf8");
  const createSql = fs.readFileSync(path.join(bundleDir, "create.sql"), "utf8");
  const rollbackSql = fs.readFileSync(path.join(bundleDir, "rollback.sql"), "utf8");

  assert.match(plan, /# Pilot Candidate Creation Plan/);
  assert.match(plan, /Decision: `GO`/);
  assert.match(plan, /## Candidate Preflight Output/);
  assert.match(plan, /preflight_result=ok/);
  assert.match(plan, /Create SQL:/);
  assert.match(plan, /Rollback SQL:/);
  assert.match(plan, /Real Submitter/);
  assert.match(createSql, /INSERT INTO organizations/);
  assert.match(createSql, /submitter_coach/);
  assert.match(createSql, /organization_admin/);
  assert.match(rollbackSql, /DELETE FROM memberships/);
  assert.match(rollbackSql, /DELETE FROM organization_memberships/);
});

test("pilot candidate creation plan blocks when creation-only fields are missing", () => {
  const profilePath = writeProfile("candidate-missing.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=missing-candidate",
    'PILOT_ORGANIZATION_NAME="Missing Organization"',
    "PILOT_ORGANIZATION_SLUG=missing-org",
    "ORGANIZATION_SLUG=missing-org",
    'PILOT_CLUB_NAME="Missing Club"',
    "PILOT_CLUB_SLUG=missing-club",
    "CLUB_SLUG=missing-club",
    'PILOT_TEAM_NAME="Missing Team"',
    "PILOT_TEAM_SLUG=missing-team",
    "TEAM_SLUG=missing-team",
    "SUBMITTER_EMAIL=submitter@missing.local"
  ]);
  const outputDir = path.join(tempRoot, "blocked-output");
  let output = "";

  try {
    output = execFileSync("bash", [scriptPath, profilePath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PILOT_CANDIDATE_CREATION_OUTPUT_DIR: outputDir
      }
    });
    assert.fail("expected creation plan to fail when required creation fields are missing");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_candidate_creation_decision=NO_GO/);
  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName);
  const plan = fs.readFileSync(path.join(outputDir, bundleName, "creation-plan.md"), "utf8");
  assert.match(plan, /## Missing Required Fields/);
  assert.match(plan, /SUBMITTER_NAME/);
  assert.match(plan, /PILOT_AGE_GROUP/);
});

test("pilot candidate creation plan blocks when the candidate preflight still fails", () => {
  const profilePath = writeProfile("candidate-placeholder.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=placeholder-candidate",
    'PILOT_ORGANIZATION_NAME="Replace With Organization Name"',
    "PILOT_ORGANIZATION_SLUG=replace-with-organization-slug",
    "ORGANIZATION_SLUG=replace-with-organization-slug",
    'PILOT_CLUB_NAME="Replace With Club Name"',
    "PILOT_CLUB_SLUG=replace-with-club-slug",
    "CLUB_SLUG=replace-with-club-slug",
    'PILOT_TEAM_NAME="Replace With Team Name"',
    "PILOT_TEAM_SLUG=replace-with-team-slug",
    "TEAM_SLUG=replace-with-team-slug",
    "PILOT_AGE_GROUP=U14",
    'SUBMITTER_NAME="Replace With Submitter Name"',
    "SUBMITTER_EMAIL=submitter@example.com",
    'ORGANIZATION_ADMIN_NAME="Replace With Organization Admin Name"',
    "ORGANIZATION_ADMIN_EMAIL=org-admin@example.com",
    'CLUB_ADMIN_NAME="Replace With Club Admin Name"',
    "CLUB_ADMIN_EMAIL=club-admin@example.com",
    'REVIEWER_NAME="Replace With Reviewer Name"',
    "REVIEWER_EMAIL=club-comms@example.com",
    'TEAM_MANAGER_REVIEWER_NAME="Replace With Team Manager Name"',
    "TEAM_MANAGER_REVIEWER_EMAIL=team-manager@example.com"
  ]);
  const outputDir = path.join(tempRoot, "placeholder-output");
  let output = "";

  try {
    output = execFileSync("bash", [scriptPath, profilePath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PILOT_CANDIDATE_CREATION_OUTPUT_DIR: outputDir
      }
    });
    assert.fail("expected creation plan to fail when preflight fails");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_candidate_creation_decision=NO_GO/);
  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName);
  const plan = fs.readFileSync(path.join(outputDir, bundleName, "creation-plan.md"), "utf8");
  assert.match(plan, /template placeholder values/);
});
