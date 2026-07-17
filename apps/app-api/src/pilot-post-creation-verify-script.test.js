import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_post_creation_verify.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-post-create-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("pilot post-creation verify runs audit then vps in dry run mode", () => {
  const outputDir = path.join(tempRoot, "bundle-a");
  const output = execFileSync("bash", [scriptPath, "simulated-north-river"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      PILOT_POST_CREATION_OUTPUT_DIR: outputDir
    }
  });

  assert.match(output, /pilot_post_creation_profile=simulated-north-river/);
  assert.match(output, /==> Run hosted audit/);
  assert.match(output, /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:audit/);
  assert.match(output, /==> Run hosted VPS scenarios/);
  assert.match(output, /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:vps/);
  assert.match(output, /pilot_post_creation_decision=GO/);

  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName);
  const bundleDir = path.join(outputDir, bundleName);
  assert.equal(fs.existsSync(path.join(bundleDir, "summary.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "handoff.md")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "commands.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "audit.log")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "vps.log")), true);

  const summary = fs.readFileSync(path.join(bundleDir, "summary.txt"), "utf8");
  assert.match(summary, /pilot_post_creation_decision=GO/);
  assert.match(summary, /audit=skipped/);
  assert.match(summary, /vps=skipped/);
});

test("pilot post-creation verify blocks vps when audit fails", () => {
  const outputDir = path.join(tempRoot, "bundle-b");
  const fakeBin = path.join(tempRoot, "fake-bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeNpm = path.join(fakeBin, "npm");
  const statePath = path.join(tempRoot, "fake-state.log");

  fs.writeFileSync(
    fakeNpm,
    `#!/usr/bin/env bash
echo "$*" >> "${statePath}"
if [[ "$*" == "run pilot:audit" ]]; then
  echo "activation_decision=NO_GO"
  exit 1
fi
if [[ "$*" == "run pilot:vps" ]]; then
  echo "Pilot readiness scenario suite passed."
  exit 0
fi
exit 0
`
  );
  fs.chmodSync(fakeNpm, 0o755);

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath, "simulated-north-river"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PILOT_POST_CREATION_OUTPUT_DIR: outputDir
      }
    });
    assert.fail("expected post-creation verify to fail when audit fails");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_post_creation_decision=NO_GO/);
  assert.doesNotMatch(output, /==> Run hosted VPS scenarios/);

  const state = fs.readFileSync(statePath, "utf8");
  assert.match(state, /run pilot:audit/);
  assert.doesNotMatch(state, /run pilot:vps/);

  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName);
  const summary = fs.readFileSync(path.join(outputDir, bundleName, "summary.txt"), "utf8");
  assert.match(summary, /audit=failed/);
  assert.match(summary, /vps=blocked audit/);
});
