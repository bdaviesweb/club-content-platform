import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/install_pilot_demo_runtime.sh");

test("install_pilot_demo_runtime prints a deterministic dry-run plan and activation file", () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-runtime-"));

  try {
    const output = execFileSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DRY_RUN: "1",
        PILOT_DEMO_RUNTIME_ROOT: runtimeRoot
      }
    });

    assert.match(output, new RegExp(`pilot_demo_runtime_root=${runtimeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(output, /postgres_url=https:\/\/github.com\/PostgresApp\/PostgresApp\/releases\/download\/v2\.9\.5\/Postgres-2\.9\.5-16\.dmg/);
    assert.match(output, /redis_url=https:\/\/download\.redis\.io\/releases\/redis-8\.8\.0\.tar\.gz/);
    assert.match(output, /minio_url=https:\/\/dl\.min\.io\/server\/minio\/release\/darwin-arm64\/minio/);
    assert.match(output, /DRY_RUN curl -fL .*Postgres-2\.9\.5-16\.dmg/);
    assert.match(output, /DRY_RUN make -C .*redis-8\.8\.0/);
    assert.match(output, /pilot_demo_runtime_activate=.*activate\.sh/);
    assert.match(output, /source ".*activate\.sh"/);
    assert.match(output, /OPEN_SURFACES=0 npm run demo:pilot/);

    const activateFile = path.join(runtimeRoot, "activate.sh");
    const activateContents = fs.readFileSync(activateFile, "utf8");
    assert.match(activateContents, new RegExp(`export PILOT_DEMO_RUNTIME_ROOT="${runtimeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(activateContents, /Postgres\.app\/Contents\/Versions\/16\/bin/);
    assert.match(activateContents, /export PATH=/);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
