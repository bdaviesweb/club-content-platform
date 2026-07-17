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
    "TEAM_MANAGER_REVIEWER_EMAIL=manager@real.local",
    "PILOT_ORG_DEFAULT_APPROVER_ROLE=team_manager",
    "PILOT_ORG_PUBLIC_APPROVER_ROLE=club_comms",
    "PILOT_ORG_MEDIUM_RISK_APPROVER_ROLE=club_comms",
    "PILOT_ORG_ALLOW_AGENT_ROUTING=yes",
    "PILOT_ORG_AUTO_APPROVE_INTERNAL_LOW_RISK=yes",
    "PILOT_ORG_AUTO_APPROVE_MAX_RISK=0.35",
    'PILOT_ORG_AUTO_APPROVAL_ALLOWED_CONTENT_TYPES="photo"',
    "PILOT_ORG_ROUTING_VIDEO_APPROVER_ROLE=club_admin",
    "PILOT_ORG_REQUIRE_SECOND_APPROVAL_PUBLIC=yes",
    "PILOT_ORG_SECOND_APPROVER_ROLE=club_admin",
    'PILOT_ORG_SECOND_APPROVAL_CONTENT_TYPES="video"',
    "PILOT_ORG_NOTIFICATION_EMAIL=yes",
    "PILOT_ORG_NOTIFICATION_PUSH=yes",
    "PILOT_CLUB_POLICY_INHERITS_ORG_DEFAULTS=yes",
    "PILOT_CLUB_OVERRIDE_AUTO_APPROVE_INTERNAL_LOW_RISK=no",
    "PILOT_CLUB_OVERRIDE_ROUTING_VIDEO_APPROVER_ROLE=team_manager",
    "PILOT_CLUB_OVERRIDE_REQUIRE_SECOND_APPROVAL_PUBLIC=no",
    "PILOT_CLUB_OVERRIDE_NOTIFICATION_EMAIL=no",
    "PILOT_CLUB_OVERRIDE_NOTIFICATION_PUSH=no"
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
  assert.match(plan, /Organization policy SQL: `configured`/);
  assert.match(plan, /Club policy SQL: `override`/);
  assert.match(createSql, /INSERT INTO organizations/);
  assert.match(createSql, /submitter_coach/);
  assert.match(createSql, /organization_admin/);
  assert.match(createSql, /INSERT INTO organization_workflow_policies/);
  assert.match(createSql, /INSERT INTO club_workflow_policies/);
  assert.match(createSql, /"allowedContentTypes":\["photo"\]/);
  assert.match(createSql, /"contentTypeApprovers":\{"video":"club_admin"\}/);
  assert.match(createSql, /"requireSecondApprovalForPublic":true/);
  assert.match(rollbackSql, /DELETE FROM memberships/);
  assert.match(rollbackSql, /DELETE FROM organization_memberships/);
  assert.match(rollbackSql, /DELETE FROM club_workflow_policies/);
  assert.match(rollbackSql, /DELETE FROM organization_workflow_policies/);
});

test("pilot candidate creation plan skips club policy SQL when the candidate fully inherits organization defaults", () => {
  const profilePath = writeProfile("candidate-inherit.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=inherit-candidate",
    'PILOT_ORGANIZATION_NAME="Inherit Organization"',
    "PILOT_ORGANIZATION_SLUG=inherit-org",
    "ORGANIZATION_SLUG=inherit-org",
    'PILOT_CLUB_NAME="Inherit Club"',
    "PILOT_CLUB_SLUG=inherit-club",
    "CLUB_SLUG=inherit-club",
    'PILOT_TEAM_NAME="Inherit Team"',
    "PILOT_TEAM_SLUG=inherit-team",
    "TEAM_SLUG=inherit-team",
    "PILOT_AGE_GROUP=U13",
    'SUBMITTER_NAME="Inherit Submitter"',
    "SUBMITTER_EMAIL=submitter@inherit.local",
    'ORGANIZATION_ADMIN_NAME="Inherit Org Admin"',
    "ORGANIZATION_ADMIN_EMAIL=org-admin@inherit.local",
    'CLUB_ADMIN_NAME="Inherit Club Admin"',
    "CLUB_ADMIN_EMAIL=club-admin@inherit.local",
    'REVIEWER_NAME="Inherit Reviewer"',
    "REVIEWER_EMAIL=reviewer@inherit.local",
    'TEAM_MANAGER_REVIEWER_NAME="Inherit Team Manager"',
    "TEAM_MANAGER_REVIEWER_EMAIL=manager@inherit.local",
    "PILOT_ORG_DEFAULT_APPROVER_ROLE=team_manager",
    "PILOT_ORG_PUBLIC_APPROVER_ROLE=club_comms",
    "PILOT_ORG_MEDIUM_RISK_APPROVER_ROLE=club_comms",
    "PILOT_CLUB_POLICY_INHERITS_ORG_DEFAULTS=yes"
  ]);
  const outputDir = path.join(tempRoot, "inherit-output");

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

  assert.match(plan, /Organization policy SQL: `configured`/);
  assert.match(plan, /Club policy SQL: `inherit`/);
  assert.match(createSql, /INSERT INTO organization_workflow_policies/);
  assert.doesNotMatch(createSql, /INSERT INTO club_workflow_policies/);
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
