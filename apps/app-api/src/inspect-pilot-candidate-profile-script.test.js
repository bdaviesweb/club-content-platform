import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-profile-inspect-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(tempRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const candidatesDir = path.join(repoRoot, "config", "pilot-candidates");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(candidatesDir, { recursive: true });

  fs.copyFileSync(
    path.resolve("scripts/inspect_pilot_candidate_profile.sh"),
    path.join(scriptsDir, "inspect_pilot_candidate_profile.sh")
  );
  fs.copyFileSync(
    path.resolve("scripts/load_pilot_candidate_env.sh"),
    path.join(scriptsDir, "load_pilot_candidate_env.sh")
  );
  fs.chmodSync(path.join(scriptsDir, "inspect_pilot_candidate_profile.sh"), 0o755);
  fs.chmodSync(path.join(scriptsDir, "load_pilot_candidate_env.sh"), 0o755);

  fs.writeFileSync(
    path.join(candidatesDir, "real-candidate.local.env"),
    [
      "PILOT_CANDIDATE_PROFILE_NAME=real-candidate",
      "PILOT_ORGANIZATION_NAME=\"Real Org\"",
      "PILOT_ORGANIZATION_SLUG=real-org",
      "ORGANIZATION_SLUG=real-org",
      "PILOT_CLUB_NAME=\"Real Club\"",
      "PILOT_CLUB_SLUG=real-club",
      "CLUB_SLUG=real-club",
      "PILOT_TEAM_NAME=\"Real Team\"",
      "PILOT_TEAM_SLUG=real-team",
      "TEAM_SLUG=real-team"
    ].join("\n")
  );

  return repoRoot;
}

test("inspect pilot candidate profile prints readable summary", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "inspect_pilot_candidate_profile.sh");

  const output = execFileSync("bash", [scriptPath, "real-candidate"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_candidate_profile_inspection/);
  assert.match(output, /profile_name=real-candidate/);
  assert.match(output, /organization_slug=real-org/);
  assert.match(output, /club_slug=real-club/);
  assert.match(output, /validation_command=PILOT_CANDIDATE_PROFILE=real-candidate bash scripts\/validate_pilot_candidate_profile\.sh/);
});
