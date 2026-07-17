import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const stopScriptPath = path.join(repoRoot, "scripts/stop_pilot_demo_runtime.sh");
const resetScriptPath = path.join(repoRoot, "scripts/reset_pilot_demo_runtime.sh");

test("pilot demo runtime stop and reset scripts print deterministic dry-run plans", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-demo-maint-"));
  const runtimeRoot = path.join(tempRoot, "runtime-root");
  const stateRoot = path.join(runtimeRoot, "state");
  const bundleRoot = path.join(tempRoot, "bundles");

  fs.mkdirSync(path.join(stateRoot, "postgres", "data"), { recursive: true });
  fs.mkdirSync(path.join(stateRoot, "redis"), { recursive: true });
  fs.mkdirSync(path.join(stateRoot, "minio"), { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, "20260622T000000Z-demo", "logs"), { recursive: true });
  fs.writeFileSync(path.join(stateRoot, "redis", "redis.pid"), "11111\n");
  fs.writeFileSync(path.join(stateRoot, "minio", "minio.pid"), "22222\n");
  fs.writeFileSync(path.join(bundleRoot, "runtime", "pilot-demo-api.pid"), "33333\n");
  fs.writeFileSync(path.join(bundleRoot, "runtime", "pilot-demo-worker.pid"), "44444\n");
  fs.writeFileSync(
    path.join(bundleRoot, "20260622T000000Z-demo", "logs", "operator-server.pid"),
    "55555\n"
  );

  try {
    const stopOutput = execFileSync("bash", [stopScriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DRY_RUN: "1",
        PILOT_DEMO_RUNTIME_ROOT: runtimeRoot,
        PILOT_DEMO_RUNTIME_STATE_ROOT: stateRoot,
        PILOT_DEMO_BUNDLE_ROOT: bundleRoot,
        PILOT_DEMO_BUNDLE_RUNTIME_ROOT: path.join(bundleRoot, "runtime")
      }
    });

    assert.match(stopOutput, /pilot_demo_runtime_root=/);
    assert.match(stopOutput, /DRY_RUN kill 33333 \(api\)/);
    assert.match(stopOutput, /DRY_RUN kill 44444 \(worker\)/);
    assert.match(stopOutput, /DRY_RUN kill 55555 \(operator\)/);
    assert.match(stopOutput, /DRY_RUN pg_ctl -D .*postgres\/data stop -m fast/);
    assert.match(stopOutput, /DRY_RUN kill 11111 \(redis\)/);
    assert.match(stopOutput, /DRY_RUN kill 22222 \(minio\)/);
    assert.match(stopOutput, /api_port_4000=missing|DRY_RUN kill .* \(api_port_4000\)/);
    assert.match(stopOutput, /admin_port_3013=missing|DRY_RUN kill .* \(admin_port_3013\)/);
    assert.match(stopOutput, /metro_port_8082=missing|DRY_RUN kill .* \(metro_port_8082\)/);

    const resetOutput = execFileSync("bash", [resetScriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DRY_RUN: "1",
        PILOT_DEMO_RUNTIME_ROOT: runtimeRoot,
        PILOT_DEMO_RUNTIME_STATE_ROOT: stateRoot,
        PILOT_DEMO_BUNDLE_ROOT: bundleRoot
      }
    });

    assert.match(resetOutput, /pilot_demo_bundle_root=/);
    assert.match(resetOutput, /DRY_RUN rm -rf .*runtime-root\/state/);
    assert.match(resetOutput, /DRY_RUN find .*bundles -mindepth 1 -maxdepth 1 -type d ! -name runtime -exec rm -rf \{\} \+/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
