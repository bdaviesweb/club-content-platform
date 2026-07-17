import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-profile-create-"));

test.after(() => {
  fs.rmSync(fixtureRepo, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRepo, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const candidatesDir = path.join(repoRoot, "config", "pilot-candidates");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(candidatesDir, { recursive: true });

  const sourceScript = path.resolve("scripts/create_pilot_candidate_profile.sh");
  fs.copyFileSync(sourceScript, path.join(scriptsDir, "create_pilot_candidate_profile.sh"));
  fs.chmodSync(path.join(scriptsDir, "create_pilot_candidate_profile.sh"), 0o755);

  fs.writeFileSync(
    path.join(candidatesDir, "pilot-candidate.template.env"),
    [
      "PILOT_CANDIDATE_PROFILE_NAME=replace-with-candidate-name",
      "PILOT_ORGANIZATION_NAME=\"Replace With Organization Name\""
    ].join("\n")
  );

  return repoRoot;
}

test("create pilot candidate profile scaffolds a local env file", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "create_pilot_candidate_profile.sh");

  const output = execFileSync("bash", [scriptPath, "real-pilot"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const createdPath = path.join(repoRoot, "config", "pilot-candidates", "real-pilot.local.env");
  assert.equal(fs.existsSync(createdPath), true);
  assert.match(fs.readFileSync(createdPath, "utf8"), /PILOT_CANDIDATE_PROFILE_NAME=real-pilot/);
  assert.match(output, /created_profile=.*real-pilot\.local\.env/);
  assert.match(output, /inspect_command=npm run pilot:inspect -- real-pilot/);
  assert.match(output, /validate_command=PILOT_CANDIDATE_PROFILE=real-pilot bash scripts\/validate_pilot_candidate_profile\.sh/);
  assert.match(output, /preflight_note=validation should fail until template placeholder values are replaced/);
});

test("create pilot candidate profile rejects invalid names", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "create_pilot_candidate_profile.sh");

  assert.throws(
    () =>
      execFileSync("bash", [scriptPath, "Real Pilot"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }),
    /lowercase letters, numbers, and hyphens only/
  );
});
