import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/start_demo_operator.sh");
const execFileAsync = promisify(execFile);

function startHttpServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === "object" && address ? address.port : 0
      });
    });
  });
}

test("start_demo_operator opens the simulator in detached mode when xcrun is available", async () => {
  const admin = await startHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/demo" ? "<html>demo</html>" : "<html>ok</html>");
  });
  const mobile = await startHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-start-demo-operator-"));
  const fakeBinDir = path.join(tempDir, "bin");
  fs.mkdirSync(fakeBinDir, { recursive: true });
  const xcrunLog = path.join(tempDir, "xcrun.log");
  const fakeXcrunPath = path.join(fakeBinDir, "xcrun");
  fs.writeFileSync(
    fakeXcrunPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(xcrunLog)}
if [[ "$1" == "simctl" && "$2" == "list" && "$3" == "devices" ]]; then
  printf '== Devices ==\\n    Test iPhone (11111111-1111-1111-1111-111111111111) (Booted)\\n'
  exit 0
fi
if [[ "$1" == "simctl" && "$2" == "get_app_container" ]]; then
  printf '/Applications/Expo Go.app\\n'
  exit 0
fi
if [[ "$1" == "simctl" && "$2" == "bootstatus" ]]; then
  exit 0
fi
if [[ "$1" == "simctl" && "$2" == "boot" ]]; then
  exit 0
fi
if [[ "$1" == "simctl" && "$2" == "launch" ]]; then
  exit 0
fi
if [[ "$1" == "simctl" && "$2" == "openurl" ]]; then
  exit 0
fi
exit 0
`,
    { mode: 0o755 }
  );

  try {
    const { stdout: output } = await execFileAsync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
        XCRUN_BIN: fakeXcrunPath,
        DETACH: "1",
        ADMIN_PORT: String(admin.port),
        MOBILE_PORT: String(mobile.port),
        MOBILE_STATUS_URL: `http://127.0.0.1:${mobile.port}/status`,
        EXPO_URL: `exp://127.0.0.1:${mobile.port}`,
        SIMULATOR_DEVICE_NAME: "Test iPhone",
        LOG_DIR: tempDir
      }
    });

    assert.match(output, /Club Content demo is ready\./);
    assert.match(output, /Mobile runtime is ready\. Opening the demo app on Test iPhone\.\.\./);

    const xcrunCalls = fs.readFileSync(xcrunLog, "utf8");
    assert.match(xcrunCalls, /simctl list devices available/);
    assert.match(xcrunCalls, /simctl boot 11111111-1111-1111-1111-111111111111/);
    assert.match(xcrunCalls, /simctl bootstatus 11111111-1111-1111-1111-111111111111 -b/);
    assert.match(xcrunCalls, /simctl get_app_container 11111111-1111-1111-1111-111111111111 host\.exp\.Exponent app/);
    assert.match(xcrunCalls, /simctl launch 11111111-1111-1111-1111-111111111111 host\.exp\.Exponent/);
    assert.match(xcrunCalls, new RegExp(`simctl openurl 11111111-1111-1111-1111-111111111111 exp://127\\.0\\.0\\.1:${mobile.port}\\?demoAction=load`));
  } finally {
    await Promise.all([
      new Promise((resolve) => admin.server.close(resolve)),
      new Promise((resolve) => mobile.server.close(resolve))
    ]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("start_demo_operator skips simulator launch in detached mode when xcrun is unavailable", async () => {
  const admin = await startHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>demo</html>");
  });
  const mobile = await startHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const { stdout: output } = await execFileAsync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: process.env.PATH,
        XCRUN_BIN: "missing-xcrun",
        DETACH: "1",
        ADMIN_PORT: String(admin.port),
        MOBILE_PORT: String(mobile.port),
        MOBILE_STATUS_URL: `http://127.0.0.1:${mobile.port}/status`,
        EXPO_URL: `exp://127.0.0.1:${mobile.port}`
      }
    });

    assert.match(output, /Club Content demo is ready\./);
    assert.match(output, /Simulator launch skipped because missing-xcrun is unavailable\./);
  } finally {
    await Promise.all([
      new Promise((resolve) => admin.server.close(resolve)),
      new Promise((resolve) => mobile.server.close(resolve))
    ]);
  }
});
