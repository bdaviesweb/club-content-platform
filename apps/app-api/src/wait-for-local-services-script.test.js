import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/wait_for_local_services.mjs");
const execFileAsync = promisify(execFile);

function listenOnRandomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.end());
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

test("wait_for_local_services reports readiness when all targets accept connections", async () => {
  const first = await listenOnRandomPort();
  const second = await listenOnRandomPort();

  try {
    const { stdout } = await execFileAsync("node", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        LOCAL_SERVICE_TARGETS: `alpha=127.0.0.1:${first.port},beta=127.0.0.1:${second.port}`,
        LOCAL_SERVICE_TIMEOUT_MS: "2000",
        LOCAL_SERVICE_RETRY_MS: "50"
      }
    });

    assert.match(stdout, /waiting_for=alpha@127\.0\.0\.1:/);
    assert.match(stdout, /waiting_for=beta@127\.0\.0\.1:/);
    assert.match(stdout, /ready=alpha@127\.0\.0\.1:/);
    assert.match(stdout, /ready=beta@127\.0\.0\.1:/);
    assert.match(stdout, /local_services_ready=2/);
  } finally {
    await Promise.all([
      new Promise((resolve) => first.server.close(resolve)),
      new Promise((resolve) => second.server.close(resolve))
    ]);
  }
});

test("wait_for_local_services exits non-zero when a target never becomes reachable", async () => {
  let output = "";
  const missingPort = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
  try {
    await execFileAsync("node", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        LOCAL_SERVICE_TARGETS: `missing=127.0.0.1:${missingPort}`,
        LOCAL_SERVICE_TIMEOUT_MS: "200",
        LOCAL_SERVICE_RETRY_MS: "50"
      }
    });
    assert.fail("expected wait_for_local_services.mjs to fail for an unreachable target");
  } catch (error) {
    assert.notEqual(error.code, 0);
    output = `${String(error.stdout || "")}${String(error.stderr || "")}`;
  }

  assert.match(output, new RegExp(`waiting_for=missing@127\\.0\\.0\\.1:${missingPort}`));
  assert.match(output, new RegExp(`timeout=missing@127\\.0\\.0\\.1:${missingPort}`));
});
