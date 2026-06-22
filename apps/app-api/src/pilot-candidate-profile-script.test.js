import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const validateScriptPath = path.join(repoRoot, "scripts/validate_pilot_candidate_profile.sh");

test("pilot candidate validator accepts the simulated north river profile", () => {
  const output = execFileSync("bash", [validateScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_CANDIDATE_PROFILE: "simulated-north-river"
    }
  });

  assert.match(output, /pilot_candidate_profile=simulated-north-river/);
  assert.match(output, /organization_slug=north-river-youth-sports/);
  assert.match(output, /preflight_result=ok/);
  assert.match(output, /validation_result=ok/);
});

test("pilot candidate validator rejects an incomplete profile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-profile-"));
  const profilePath = path.join(tempDir, "broken-profile.env");
  fs.writeFileSync(
    profilePath,
    [
      "PILOT_CANDIDATE_PROFILE_NAME=broken-profile",
      'PILOT_ORGANIZATION_NAME="Broken Org"',
      "PILOT_ORGANIZATION_SLUG=broken-org",
      "ORGANIZATION_SLUG=broken-org"
    ].join("\n")
  );

  try {
    assert.throws(
      () =>
        execFileSync("bash", [validateScriptPath, profilePath], {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"]
        }),
      /missing required values/i
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pilot candidate validator rejects untouched template placeholder values", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-template-"));
  const profilePath = path.join(tempDir, "template-profile.local.env");
  fs.writeFileSync(
    profilePath,
    [
      "PILOT_CANDIDATE_PROFILE_NAME=replace-with-candidate-name",
      'PILOT_ORGANIZATION_NAME="Replace With Organization Name"',
      "PILOT_ORGANIZATION_SLUG=replace-with-organization-slug",
      "ORGANIZATION_SLUG=replace-with-organization-slug",
      'PILOT_CLUB_NAME="Replace With Club Name"',
      "PILOT_CLUB_SLUG=replace-with-club-slug",
      "CLUB_SLUG=replace-with-club-slug",
      'PILOT_TEAM_NAME="Replace With Team Name"',
      "PILOT_TEAM_SLUG=replace-with-team-slug",
      "TEAM_SLUG=replace-with-team-slug",
      "SUBMITTER_EMAIL=submitter@example.com",
      "ORGANIZATION_ADMIN_EMAIL=org-admin@example.com",
      "CLUB_ADMIN_EMAIL=club-admin@example.com",
      "REVIEWER_EMAIL=club-comms@example.com",
      "TEAM_MANAGER_REVIEWER_EMAIL=team-manager@example.com"
    ].join("\n")
  );

  try {
    assert.throws(
      () =>
        execFileSync("bash", [validateScriptPath, profilePath], {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"]
        }),
      /template placeholder values/i
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
