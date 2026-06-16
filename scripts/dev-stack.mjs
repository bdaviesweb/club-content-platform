#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const apiPort = Number(process.env.CLUB_API_PORT || process.env.API_PORT || 4000);
const adminPort = Number(process.env.CLUB_ADMIN_PORT || process.env.PORT || 3001);
const mobileWebPort = Number(process.env.CLUB_MOBILE_WEB_PORT || 19006);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const remoteApiBase = process.env.EXPO_PUBLIC_API_BASE_URL || "https://clubcontent-api.davmn.net";

const children = new Map();

function start(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv
    },
    stdio: "inherit"
  });

  children.set(name, child);
  child.on("exit", (code, signal) => {
    children.delete(name);

    if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
      return;
    }

    console.error(`\n${name} exited unexpectedly (${signal || code}). Stopping the rest of the stack.`);
    shutdown(code || 1);
  });

  return child;
}

function waitForPort(host, port, timeoutMs = 60000) {
  const startedAt = Date.now();

  return new Promise((resolvePromise, rejectPromise) => {
    function attempt() {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.end();
        resolvePromise();
      });

      socket.once("error", () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeoutMs) {
          rejectPromise(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }

        setTimeout(attempt, 1000).unref();
      });
    }

    attempt();
  });
}

function ensureLocalServices() {
  if (String(process.env.SKIP_LOCAL_SERVICES || "").toLowerCase() === "true") {
    console.log("Skipping local Docker services because SKIP_LOCAL_SERVICES=true.");
    return false;
  }

  const result = spawnSync("docker", ["compose", "up", "-d", "postgres", "redis", "minio"], {
    cwd: repoRoot,
    stdio: "inherit"
  });

  if (result.error?.code === "ENOENT") {
    console.log("Docker is not installed here, so local database and storage services are being skipped.");
    console.log("Start them another way, or rerun with SKIP_LOCAL_SERVICES=true to silence this note.");
    return false;
  }

  if (result.status !== 0) {
    throw new Error("Failed to start local Docker services");
  }

  return true;
}

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children.values()) {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    for (const child of children.values()) {
      child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Club Content dev stack");
console.log(`  API:     http://localhost:${apiPort}`);
console.log(`  Admin:   http://localhost:${adminPort}`);
console.log(`  Mobile:  http://localhost:${mobileWebPort}`);
console.log("  Worker:  background process");
console.log("");
console.log("Use these exact URLs instead of bare localhost to avoid opening the wrong app.");
console.log("");

let localServicesStarted = false;
try {
  localServicesStarted = ensureLocalServices();
  if (localServicesStarted) {
    console.log("Waiting for local storage and database services...");
    await Promise.all([
      waitForPort("127.0.0.1", 5432),
      waitForPort("127.0.0.1", 6379),
      waitForPort("127.0.0.1", 9000)
    ]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const sharedFrontendEnv = {
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || "http://localhost:3000",
  ADMIN_APP_URL: process.env.ADMIN_APP_URL || `http://localhost:${adminPort}`,
  API_BASE_URL: process.env.API_BASE_URL || remoteApiBase,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || remoteApiBase
};

if (localServicesStarted) {
  const localDefaults = {
    ...sharedFrontendEnv,
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://club:club@localhost:5432/club_content",
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
    S3_ENDPOINT: process.env.S3_ENDPOINT || "http://localhost:9000",
    S3_BUCKET: process.env.S3_BUCKET || "club-content",
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || "minioadmin",
    S3_SECRET_KEY: process.env.S3_SECRET_KEY || "minioadmin",
    S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL || "http://localhost:9000"
  };

  start("api", "npm", ["--workspace", "@club/app-api", "run", "dev"], {
    ...localDefaults,
    API_PORT: String(apiPort)
  });

  start("admin", "npm", ["--workspace", "@club/admin-web", "run", "dev"], {
    ...localDefaults,
    PORT: String(adminPort)
  });

  start("worker", "npm", ["--workspace", "@club/worker", "run", "dev"], {
    ...localDefaults
  });

  start(
    "mobile-web",
    "npm",
    ["--workspace", "@club/mobile", "run", "web", "--", "--port", String(mobileWebPort)],
    {
      ...localDefaults
    }
  );
} else {
  console.log("Starting frontend apps only because the local backend services are unavailable.");
  start("admin", "npm", ["--workspace", "@club/admin-web", "run", "dev"], {
    ...sharedFrontendEnv,
    PORT: String(adminPort)
  });

  start(
    "mobile-web",
    "npm",
    ["--workspace", "@club/mobile", "run", "web", "--", "--port", String(mobileWebPort)],
    {
      ...sharedFrontendEnv
    }
  );
}
