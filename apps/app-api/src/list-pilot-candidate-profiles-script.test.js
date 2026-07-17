import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-profile-list-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("list pilot candidate profiles shows committed, template, and local profiles", () => {
  const repoRoot = path.join(tempRoot, "repo");
  const scriptsDir = path.join(repoRoot, "scripts");
  const candidatesDir = path.join(repoRoot, "config", "pilot-candidates");

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(candidatesDir, { recursive: true });

  fs.copyFileSync(
    path.resolve("scripts/list_pilot_candidate_profiles.sh"),
    path.join(scriptsDir, "list_pilot_candidate_profiles.sh")
  );
  fs.chmodSync(path.join(scriptsDir, "list_pilot_candidate_profiles.sh"), 0o755);

  fs.writeFileSync(path.join(candidatesDir, "pilot-candidate.template.env"), "TEMPLATE=1\n");
  fs.writeFileSync(path.join(candidatesDir, "simulated-north-river.env"), "SIMULATED=1\n");
  fs.writeFileSync(path.join(candidatesDir, "real-club.local.env"), "REAL=1\n");

  const output = execFileSync("bash", [path.join(scriptsDir, "list_pilot_candidate_profiles.sh")], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_candidate_profiles/);
  assert.match(output, /pilot-candidate\.template\|template\|pilot-candidate\.template\.env/);
  assert.match(output, /real-club\.local\|local\|real-club\.local\.env/);
  assert.match(output, /simulated-north-river\|committed\|simulated-north-river\.env/);
});
