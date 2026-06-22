import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_demo.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-demo-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("pilot demo script assembles a repeatable operator bundle in dry run mode", () => {
  const outputDir = path.join(tempRoot, "bundle-a");
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      OPEN_SURFACES: "1",
      PILOT_CANDIDATE_PROFILE: "simulated-north-river",
      PILOT_DEMO_OUTPUT_DIR: outputDir
    }
  });

  assert.match(output, /pilot_demo_profile=simulated-north-river/);
  assert.match(output, /pilot_demo_profile_path=.*simulated-north-river\.env/);
  assert.match(output, /pilot_demo_bundle_path=.*bundle-a.*simulated-north-river/);
  assert.match(output, /pilot_demo_runbook_path=.*runbook\.md/);
  assert.match(output, /pilot_demo_evidence_path=.*evidence\.md/);
  assert.match(output, /pilot_demo_preflight_path=.*preflight\.md/);
  assert.match(output, /==> Boot local demo services/);
  assert.match(output, /DRY_RUN docker compose up -d postgres redis minio && node .*scripts\/wait_for_local_services\.mjs/);
  assert.match(output, /==> Start local app API/);
  assert.match(output, /DRY_RUN env DATABASE_URL=postgresql:\/\/club:club@localhost:5432\/club_content REDIS_URL=redis:\/\/localhost:6379 S3_ENDPOINT=http:\/\/localhost:9000 S3_BUCKET=club-content S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin S3_PUBLIC_BASE_URL=http:\/\/localhost:9000 API_PORT=4000 npm --workspace @club\/app-api run dev/);
  assert.match(output, /==> Start local worker/);
  assert.match(output, /DRY_RUN env DATABASE_URL=postgresql:\/\/club:club@localhost:5432\/club_content REDIS_URL=redis:\/\/localhost:6379 S3_ENDPOINT=http:\/\/localhost:9000 S3_BUCKET=club-content S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin S3_PUBLIC_BASE_URL=http:\/\/localhost:9000 npm --workspace @club\/worker run dev/);
  assert.match(output, /==> Reset simulator organization state/);
  assert.match(output, /DRY_RUN env DATABASE_URL=postgresql:\/\/club:club@localhost:5432\/club_content npm run pilot:simulator-state/);
  assert.match(output, /==> Start operator demo surfaces/);
  assert.match(output, /DRY_RUN env API_BASE_URL=http:\/\/127\.0\.0\.1:4000 EXPO_PUBLIC_API_BASE_URL=http:\/\/127\.0\.0\.1:4000 LOG_DIR=.* ADMIN_PORT=3013 MOBILE_PORT=8082 DETACH=1 bash scripts\/start_demo_operator\.sh/);
  assert.match(output, /==> Open demo surfaces/);
  assert.match(output, /DRY_RUN open http:\/\/127\.0\.0\.1:3013\/demo http:\/\/127\.0\.0\.1:3013\/quick-review http:\/\/127\.0\.0\.1:3013\/workflow-settings\\\?organizationMode=simulator\\&clubSlug=north-river-soccer-club/);
  assert.match(output, /pilot_demo_decision=GO/);
  assert.match(output, /pilot_demo_result=ok/);

  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName, "expected a demo bundle directory");

  const bundleDir = path.join(outputDir, bundleName);
  assert.equal(fs.existsSync(path.join(bundleDir, "summary.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "status.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "commands.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "runbook.md")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "evidence.md")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "links.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "preflight.md")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "artifacts", "manifest.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "artifacts", "capture-plan.txt")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "services.log")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "api.log")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "worker.log")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "operator.log")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "artifacts.log")), true);

  const status = fs.readFileSync(path.join(bundleDir, "status.txt"), "utf8");
  assert.match(status, /services=skipped/);
  assert.match(status, /api=skipped/);
  assert.match(status, /worker=skipped/);
  assert.match(status, /simulator_state=skipped/);
  assert.match(status, /operator=skipped/);
  assert.match(status, /open=skipped/);
  assert.match(status, /artifacts=skipped/);

  const commands = fs.readFileSync(path.join(bundleDir, "commands.txt"), "utf8");
  assert.match(commands, /docker compose up -d postgres redis minio/);
  assert.match(commands, /node .*scripts\/wait_for_local_services\.mjs/);
  assert.match(commands, /npm --workspace @club\/app-api run dev/);
  assert.match(commands, /npm --workspace @club\/worker run dev/);
  assert.match(commands, /npm run pilot:simulator-state/);
  assert.match(commands, /env API_BASE_URL=http:\/\/127\.0\.0\.1:4000 EXPO_PUBLIC_API_BASE_URL=http:\/\/127\.0\.0\.1:4000 LOG_DIR=.* ADMIN_PORT=3013 MOBILE_PORT=8082 DETACH=1 bash scripts\/start_demo_operator\.sh/);
  assert.match(commands, /open http:\/\/127\.0\.0\.1:3013\/demo/);

  const runbook = fs.readFileSync(path.join(bundleDir, "runbook.md"), "utf8");
  assert.match(runbook, /# Pilot Demo Runbook/);
  assert.match(runbook, /Decision: `GO`/);
  assert.match(runbook, /Artifact manifest: `.*artifacts\/manifest\.txt`/);
  assert.match(runbook, /Machine manifest: `.*manifest\.json`/);
  assert.match(runbook, /Demo command center: `http:\/\/127\.0\.0\.1:3013\/demo`/);
  assert.match(runbook, /Simulator workflow settings: `http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club`/);
  assert.match(runbook, /Expo launch URL: `exp:\/\/127\.0\.0\.1:8082`/);
  assert.match(runbook, /Internal feed: `http:\/\/127\.0\.0\.1:4000\/feed\/internal\?includeSmoke=1`/);
  assert.match(runbook, /## Happy Path/);
  assert.match(runbook, /## Exception Paths/);

  const evidence = fs.readFileSync(path.join(bundleDir, "evidence.md"), "utf8");
  assert.match(evidence, /# Pilot Demo Evidence/);
  assert.match(evidence, /Poster launch URL: `exp:\/\/127\.0\.0\.1:8082\?demoAction=post`/);
  assert.match(evidence, /Published output: `http:\/\/127\.0\.0\.1:4000\/feed\/internal\?includeSmoke=1`/);
  assert.match(evidence, /## Captured Artifacts/);
  assert.match(evidence, /Manifest: `.*artifacts\/manifest\.txt`/);
  assert.match(evidence, /Machine manifest: `.*manifest\.json`/);
  assert.match(evidence, /Capture plan: `.*artifacts\/capture-plan\.txt`/);
  assert.match(evidence, /Scenario URL: `http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0\.12&simulationModerationFlagged=false`/);
  assert.match(evidence, /Scenario URL: `http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club&simulationContentType=video&simulationVisibilityTarget=public&simulationRiskScore=0\.42&simulationModerationFlagged=false`/);
  assert.match(evidence, /Local app API: `.*logs\/api\.log`/);
  assert.match(evidence, /Local worker: `.*logs\/worker\.log`/);
  assert.match(evidence, /Operator admin log: `.*logs\/admin-demo\.log`/);
  assert.match(evidence, /Operator mobile log: `.*logs\/mobile-demo\.log`/);

  const links = fs.readFileSync(path.join(bundleDir, "links.txt"), "utf8");
  assert.match(links, /happy_path_post=exp:\/\/127\.0\.0\.1:8082\?demoAction=post/);
  assert.match(links, /exception_auto_approval=http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0\.12&simulationModerationFlagged=false/);
  assert.match(links, /exception_second_approval=http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club&simulationContentType=video&simulationVisibilityTarget=public&simulationRiskScore=0\.42&simulationModerationFlagged=false/);
  assert.match(links, /internal_feed=http:\/\/127\.0\.0\.1:4000\/feed\/internal\?includeSmoke=1/);

  const preflight = fs.readFileSync(path.join(bundleDir, "preflight.md"), "utf8");
  assert.match(preflight, /# Pilot Demo Preflight/);
  assert.match(preflight, /Decision: `GO`/);
  assert.match(preflight, /Docker available: `false`/);
  assert.match(preflight, /Local API base: `http:\/\/127\.0\.0\.1:4000`/);
  assert.match(preflight, /Artifact manifest: `.*artifacts\/manifest\.txt`/);
  assert.match(preflight, /Machine manifest: `.*manifest\.json`/);

  const manifest = fs.readFileSync(path.join(bundleDir, "artifacts", "manifest.txt"), "utf8");
  assert.match(manifest, /demo_command_center\|http:\/\/127\.0\.0\.1:3013\/demo\|.*artifacts\/demo-command-center\.html/);
  assert.match(manifest, /internal_feed\|http:\/\/127\.0\.0\.1:4000\/feed\/internal\?includeSmoke=1\|.*artifacts\/internal-feed\.json/);

  const capturePlan = fs.readFileSync(path.join(bundleDir, "artifacts", "capture-plan.txt"), "utf8");
  assert.match(capturePlan, /Artifact capture plan for a live run:/);
  assert.match(capturePlan, /exception_auto_approval\|http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0\.12&simulationModerationFlagged=false\|/);

  const machineManifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
  assert.equal(machineManifest.profile, "simulated-north-river");
  assert.equal(machineManifest.decision, "GO");
  assert.equal(machineManifest.localRuntimeAvailable, false);
  assert.match(machineManifest.paths.operatorAdminLog, /logs\/admin-demo\.log$/);
  assert.match(machineManifest.urls.exceptionSecondApproval, /simulationContentType=video/);
});

test("pilot demo script exits with a clear no-go bundle when no local runtime is available", () => {
  const outputDir = path.join(tempRoot, "bundle-b");
  let output = "";

  try {
    output = execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PILOT_CANDIDATE_PROFILE: "simulated-north-river",
        PILOT_DEMO_OUTPUT_DIR: outputDir,
        PILOT_DEMO_RUNTIME_MODE: "force_unavailable"
      }
    });
    assert.fail("expected pilot_demo.sh to exit non-zero when local runtime is unavailable");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /services=blocked runtime/);
  assert.match(output, /api=blocked runtime/);
  assert.match(output, /worker=blocked runtime/);
  assert.match(output, /simulator_state=blocked runtime/);
  assert.match(output, /operator=blocked/);
  assert.match(output, /open=blocked/);
  assert.match(output, /pilot_demo_decision=NO_GO/);

  const bundleName = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())?.name;
  assert.ok(bundleName, "expected a blocked demo bundle directory");

  const bundleDir = path.join(outputDir, bundleName);
  const status = fs.readFileSync(path.join(bundleDir, "status.txt"), "utf8");
  assert.match(status, /services=blocked runtime/);
  assert.match(status, /api=blocked runtime/);
  assert.match(status, /worker=blocked runtime/);
  assert.match(status, /simulator_state=blocked runtime/);
  assert.match(status, /operator=blocked/);
  assert.match(status, /open=blocked/);
  assert.match(status, /artifacts=blocked/);

  const preflight = fs.readFileSync(path.join(bundleDir, "preflight.md"), "utf8");
  assert.match(preflight, /Decision: `NO_GO`/);
  assert.match(preflight, /Local runtime available: `false`/);
  assert.match(preflight, /Runtime mode: `force_unavailable`/);
  assert.match(preflight, /Machine manifest: `.*manifest\.json`/);
  assert.match(preflight, /## Recovery Steps/);
  assert.match(preflight, /Install Docker Desktop or provide local `postgres`, `redis-server`, and `minio` binaries on this machine\./);
  assert.match(preflight, /Rerun `npm run demo:pilot` after local services are available\./);
  assert.match(preflight, /DRY_RUN=1 npm run demo:pilot/);

  const runbook = fs.readFileSync(path.join(bundleDir, "runbook.md"), "utf8");
  assert.match(runbook, /## Recovery Steps/);
  assert.match(runbook, /Install Docker Desktop or provide local `postgres`, `redis-server`, and `minio` binaries\./);
  assert.match(runbook, /Rerun `npm run demo:pilot` once the local runtime is available\./);

  const evidence = fs.readFileSync(path.join(bundleDir, "evidence.md"), "utf8");
  assert.match(evidence, /## Captured Artifacts/);
  assert.match(evidence, /Machine manifest: `.*manifest\.json`/);
  assert.match(evidence, /Capture plan: `.*artifacts\/capture-plan\.txt`/);
  assert.match(evidence, /## Recovery Steps/);
  assert.match(evidence, /Install Docker Desktop or local `postgres`, `redis-server`, and `minio` binaries before the next live demo attempt\./);
  assert.match(evidence, /Use `DRY_RUN=1 npm run demo:pilot` if you need a shareable operator packet while runtime setup is still pending\./);

  const capturePlan = fs.readFileSync(path.join(bundleDir, "artifacts", "capture-plan.txt"), "utf8");
  assert.match(capturePlan, /Artifact capture was skipped because the operator surfaces were not started\./);
  assert.match(capturePlan, /workflow_settings\|http:\/\/127\.0\.0\.1:3013\/workflow-settings\?organizationMode=simulator&clubSlug=north-river-soccer-club\|/);

  const machineManifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
  assert.equal(machineManifest.decision, "NO_GO");
  assert.equal(machineManifest.runtimeMode, "force_unavailable");
  assert.equal(machineManifest.localRuntimeAvailable, false);
});

test("pilot demo script completes a non-dry-run success path with injected local commands", () => {
  const outputDir = path.join(tempRoot, "bundle-c");
  const fixtureDir = fs.mkdtempSync(path.join(tempRoot, "fixture-c-"));
  const helpersDir = path.join(fixtureDir, "helpers");
  fs.mkdirSync(helpersDir, { recursive: true });

  const helper = (name, content) => {
    const helperPath = path.join(helpersDir, name);
    fs.writeFileSync(helperPath, content, { mode: 0o755 });
    return helperPath;
  };

  const servicesScript = helper(
    "services.sh",
    `#!/usr/bin/env bash
set -euo pipefail
echo services_ready
`
  );

  const apiScript = helper(
    "api.js",
    `#!/usr/bin/env node
const http = require("node:http");
const port = Number(process.env.API_PORT || 4000);
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/feed/internal?includeSmoke=1") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: "demo-post", status: "published" }] }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
server.listen(port, "127.0.0.1");
`
  );

  const workerScript = helper(
    "worker.js",
    `#!/usr/bin/env node
setInterval(() => {}, 1000);
`
  );

  const simulatorScript = helper(
    "simulator.sh",
    `#!/usr/bin/env bash
set -euo pipefail
echo simulator_reset_complete
`
  );

  const operatorScript = helper(
    "operator.sh",
    `#!/usr/bin/env bash
set -euo pipefail
: "\${LOG_DIR:?}"
: "\${ADMIN_PORT:=3013}"
mkdir -p "\${LOG_DIR}"
printf 'fake admin log\\n' > "\${LOG_DIR}/admin-demo.log"
printf 'fake mobile log\\n' > "\${LOG_DIR}/mobile-demo.log"
nohup node -e '
  const http = require("node:http");
  const port = Number(process.env.ADMIN_PORT || 3013);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url.startsWith("/workflow-settings")) {
      res.end("<html><body>workflow settings " + req.url + "</body></html>");
      return;
    }
    if (req.url === "/quick-review") {
      res.end("<html><body>quick review</body></html>");
      return;
    }
    if (req.url === "/demo") {
      res.end("<html><body>demo command center</body></html>");
      return;
    }
    res.end("<html><body>ok</body></html>");
  });
  server.listen(port, "127.0.0.1");
' </dev/null > "\${LOG_DIR}/operator-server.log" 2>&1 &
echo $! > "\${LOG_DIR}/operator-server.pid"
echo operator_ready
`
  );

  const openScript = helper(
    "open.sh",
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > ${JSON.stringify(path.join(fixtureDir, "open.txt"))}
`
  );

  let output = "";
  let bundleDir = "";
  try {
    output = execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PILOT_CANDIDATE_PROFILE: "simulated-north-river",
        PILOT_DEMO_OUTPUT_DIR: outputDir,
        PILOT_DEMO_RUNTIME_MODE: "force_available",
        PILOT_DEMO_SERVICES_COMMAND: `bash ${JSON.stringify(servicesScript)}`,
        PILOT_DEMO_API_COMMAND: `node ${JSON.stringify(apiScript)}`,
        PILOT_DEMO_WORKER_COMMAND: `node ${JSON.stringify(workerScript)}`,
        PILOT_DEMO_SIMULATOR_COMMAND: `bash ${JSON.stringify(simulatorScript)}`,
        PILOT_DEMO_OPERATOR_COMMAND: `bash ${JSON.stringify(operatorScript)}`,
        PILOT_DEMO_OPEN_COMMAND: `bash ${JSON.stringify(openScript)} http://127.0.0.1:3013/demo http://127.0.0.1:3013/quick-review "http://127.0.0.1:3013/workflow-settings?organizationMode=simulator&clubSlug=north-river-soccer-club"`,
        ADMIN_PORT: "3013",
        API_PORT: "4000",
        OPEN_SURFACES: "1"
      }
    });
  } finally {
    const runtimeDir = path.join(outputDir, "runtime");
    for (const pidName of ["pilot-demo-api.pid", "pilot-demo-worker.pid"]) {
      const pidPath = path.join(runtimeDir, pidName);
      if (fs.existsSync(pidPath)) {
        try {
          process.kill(Number(fs.readFileSync(pidPath, "utf8").trim()), "SIGTERM");
        } catch {}
      }
    }
    const bundleName = fs
      .readdirSync(outputDir, { withFileTypes: true })
      .find((entry) => entry.isDirectory())?.name;
    bundleDir = bundleName ? path.join(outputDir, bundleName) : "";
    const operatorPidPath = bundleDir ? path.join(bundleDir, "logs", "operator-server.pid") : "";
    if (operatorPidPath && fs.existsSync(operatorPidPath)) {
      try {
        process.kill(Number(fs.readFileSync(operatorPidPath, "utf8").trim()), "SIGTERM");
      } catch {}
    }
  }

  assert.match(output, /services=ok/);
  assert.match(output, /api=ok/);
  assert.match(output, /worker=ok/);
  assert.match(output, /simulator_state=ok/);
  assert.match(output, /operator=ok/);
  assert.match(output, /open=ok/);
  assert.match(output, /artifacts=ok/);
  assert.match(output, /pilot_demo_decision=GO/);
  assert.match(output, /pilot_demo_result=ok/);

  assert.ok(bundleDir, "expected a successful demo bundle directory");

  const status = fs.readFileSync(path.join(bundleDir, "status.txt"), "utf8");
  assert.match(status, /services=ok/);
  assert.match(status, /api=ok/);
  assert.match(status, /worker=ok/);
  assert.match(status, /simulator_state=ok/);
  assert.match(status, /operator=ok/);
  assert.match(status, /open=ok/);
  assert.match(status, /artifacts=ok/);

  const artifactsDir = path.join(bundleDir, "artifacts");
  assert.equal(fs.existsSync(path.join(artifactsDir, "demo-command-center.html")), true);
  assert.equal(fs.existsSync(path.join(artifactsDir, "quick-review.html")), true);
  assert.equal(fs.existsSync(path.join(artifactsDir, "workflow-settings.html")), true);
  assert.equal(fs.existsSync(path.join(artifactsDir, "exception-auto-approval.html")), true);
  assert.equal(fs.existsSync(path.join(artifactsDir, "exception-second-approval.html")), true);
  assert.equal(fs.existsSync(path.join(artifactsDir, "internal-feed.json")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "admin-demo.log")), true);
  assert.equal(fs.existsSync(path.join(bundleDir, "logs", "mobile-demo.log")), true);

  const evidence = fs.readFileSync(path.join(bundleDir, "evidence.md"), "utf8");
  assert.match(evidence, /Demo command center HTML: `.*artifacts\/demo-command-center\.html`/);
  assert.match(evidence, /Internal feed JSON: `.*artifacts\/internal-feed\.json`/);

  const machineManifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
  assert.equal(machineManifest.decision, "GO");
  assert.equal(machineManifest.localRuntimeAvailable, true);
  assert.match(machineManifest.paths.operatorAdminLog, /logs\/admin-demo\.log$/);

  const feedJson = JSON.parse(fs.readFileSync(path.join(artifactsDir, "internal-feed.json"), "utf8"));
  assert.deepEqual(feedJson, { items: [{ id: "demo-post", status: "published" }] });

  const openLog = fs.readFileSync(path.join(fixtureDir, "open.txt"), "utf8");
  assert.match(openLog, /http:\/\/127\.0\.0\.1:3013\/demo/);
});
