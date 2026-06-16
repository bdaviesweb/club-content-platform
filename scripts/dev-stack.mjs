#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const apiPort = Number(process.env.CLUB_API_PORT || process.env.API_PORT || 4000);
const adminPort = Number(process.env.CLUB_ADMIN_PORT || process.env.PORT || 3001);
const mobileWebPort = Number(process.env.CLUB_MOBILE_WEB_PORT || 19006);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

start("api", "npm", ["--workspace", "@club/app-api", "run", "dev"], {
  API_PORT: String(apiPort)
});

start("admin", "npm", ["--workspace", "@club/admin-web", "run", "dev"], {
  PORT: String(adminPort),
  API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${apiPort}`
});

start("worker", "npm", ["--workspace", "@club/worker", "run", "dev"]);

start(
  "mobile-web",
  "npm",
  ["--workspace", "@club/mobile", "run", "web", "--", "--port", String(mobileWebPort)],
  {
    EXPO_PUBLIC_API_BASE_URL:
      process.env.EXPO_PUBLIC_API_BASE_URL || `http://localhost:${apiPort}`
  }
);
