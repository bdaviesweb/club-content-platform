import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-test-tenant-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo({ simulatorExitCode = 0 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_test_tenant_setup.sh");
  const targetPath = path.join(scriptsDir, "pilot_test_tenant_setup.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  fs.writeFileSync(path.join(docsDir, "pilot-sandbox-intake.txt"), "candidate_profile_name=sandbox-summit-pilot\n");
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        name: "pilot-test-tenant-fixture",
        private: true,
        scripts: {
          "pilot:sandbox": "node scripts/pilot-sandbox.js",
          "pilot:simulator-state": "node scripts/pilot-simulator-state.js"
        }
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(scriptsDir, "pilot-sandbox.js"),
    [
      'console.log("sandbox_refresh_complete");'
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(scriptsDir, "pilot-simulator-state.js"),
    [
      'console.log("simulator_refresh_attempted");',
      `process.exit(${simulatorExitCode});`
    ].join("\n")
  );

  return repoRoot;
}

test("test-tenant setup rebuilds sandbox artifacts and refreshes the simulator state when available", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_test_tenant_setup.sh");

  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_test_tenant_profile=simulated-north-river/);
  assert.match(output, /sandbox_refresh_complete/);
  assert.match(output, /pilot_test_tenant_sandbox=ok/);
  assert.match(output, /simulator_refresh_attempted/);
  assert.match(output, /pilot_test_tenant_simulator_state=ok/);
  assert.match(output, /pilot_test_tenant_next_1=npm run demo:pilot/);
  assert.match(output, /pilot_test_tenant_surface_workflow=http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club/);
});

test("test-tenant setup stays usable when simulator reset is blocked", () => {
  const repoRoot = setupFixtureRepo({ simulatorExitCode: 1 });
  const scriptPath = path.join(repoRoot, "scripts", "pilot_test_tenant_setup.sh");

  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_test_tenant_sandbox=ok/);
  assert.match(output, /pilot_test_tenant_simulator_state=blocked/);
  assert.match(output, /pilot_test_tenant_hint=start the local demo stack, then rerun npm run pilot:test-tenant/);
  assert.match(output, /pilot_test_tenant_decision=GO/);
});
