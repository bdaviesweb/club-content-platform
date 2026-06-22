import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-apply-sql-"));

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
  fs.mkdirSync(path.join(repoRoot, "config", "pilot-candidates"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "tmp", "pilot-candidate-create-plan"), { recursive: true });

  for (const scriptName of [
    "pilot_apply_candidate_sql.sh",
    "load_pilot_candidate_env.sh"
  ]) {
    copyScript(repoRoot, scriptName);
  }

  return repoRoot;
}

test("pilot apply candidate sql locates the latest create sql and logs a dry run", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_apply_candidate_sql.sh");
  const candidateProfilePath = path.join(repoRoot, "config", "pilot-candidates", "block-club-pilot.local.env");
  const creationDir = path.join(
    repoRoot,
    "tmp",
    "pilot-candidate-create-plan",
    "20260622T010000Z-block-club-pilot"
  );
  const createSqlPath = path.join(creationDir, "create.sql");
  const rollbackSqlPath = path.join(creationDir, "rollback.sql");

  fs.writeFileSync(
    candidateProfilePath,
    [
      "PILOT_CANDIDATE_PROFILE_NAME=block-club-pilot",
      "PILOT_ORGANIZATION_SLUG=block-org",
      "ORGANIZATION_SLUG=block-org",
      "PILOT_CLUB_SLUG=block-club",
      "CLUB_SLUG=block-club"
    ].join("\n")
  );

  fs.mkdirSync(creationDir, { recursive: true });
  fs.writeFileSync(createSqlPath, "select 1;\n");
  fs.writeFileSync(rollbackSqlPath, "select 2;\n");
  fs.writeFileSync(
    path.join(creationDir, "summary.txt"),
    [
      "pilot_candidate_creation_profile=block-club-pilot",
      `pilot_candidate_creation_create_sql=${createSqlPath}`,
      `pilot_candidate_creation_rollback_sql=${rollbackSqlPath}`,
      "pilot_candidate_creation_decision=GO"
    ].join("\n")
  );

  const outputDir = path.join(repoRoot, "tmp", "pilot-sql-apply");
  const output = execFileSync("bash", [scriptPath, "block-club-pilot", "create"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      PILOT_SQL_APPLY_OUTPUT_DIR: outputDir,
      PILOT_CANDIDATE_CREATION_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-candidate-create-plan")
    }
  });

  assert.match(output, /pilot_sql_apply_profile=block-club-pilot/);
  assert.match(output, /pilot_sql_apply_mode=create/);
  assert.match(output, /pilot_sql_apply_decision=GO/);
  assert.match(output, /create\.sql/);

  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName);
  const summary = fs.readFileSync(path.join(outputDir, bundleName, "summary.txt"), "utf8");
  assert.match(summary, /apply=skipped/);
});

test("pilot apply candidate sql can target rollback sql", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_apply_candidate_sql.sh");
  const candidateProfilePath = path.join(repoRoot, "config", "pilot-candidates", "block-club-pilot.local.env");
  const creationDir = path.join(
    repoRoot,
    "tmp",
    "pilot-candidate-create-plan",
    "20260622T010000Z-block-club-pilot"
  );
  const createSqlPath = path.join(creationDir, "create.sql");
  const rollbackSqlPath = path.join(creationDir, "rollback.sql");

  fs.writeFileSync(candidateProfilePath, "PILOT_CANDIDATE_PROFILE_NAME=block-club-pilot\n");
  fs.mkdirSync(creationDir, { recursive: true });
  fs.writeFileSync(createSqlPath, "select 1;\n");
  fs.writeFileSync(rollbackSqlPath, "select 2;\n");
  fs.writeFileSync(
    path.join(creationDir, "summary.txt"),
    [
      "pilot_candidate_creation_profile=block-club-pilot",
      `pilot_candidate_creation_create_sql=${createSqlPath}`,
      `pilot_candidate_creation_rollback_sql=${rollbackSqlPath}`,
      "pilot_candidate_creation_decision=GO"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, "block-club-pilot", "rollback"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      PILOT_SQL_APPLY_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-sql-apply"),
      PILOT_CANDIDATE_CREATION_OUTPUT_DIR: path.join(repoRoot, "tmp", "pilot-candidate-create-plan")
    }
  });

  assert.match(output, /pilot_sql_apply_mode=rollback/);
  assert.match(output, /rollback\.sql/);
});
