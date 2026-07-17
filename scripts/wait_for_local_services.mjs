#!/usr/bin/env node

import net from "node:net";

const timeoutMs = Number(process.env.LOCAL_SERVICE_TIMEOUT_MS || 60000);
const retryMs = Number(process.env.LOCAL_SERVICE_RETRY_MS || 1000);
const targets = parseTargets(
  process.env.LOCAL_SERVICE_TARGETS ||
    "postgres=127.0.0.1:5432,redis=127.0.0.1:6379,minio=127.0.0.1:9000"
);

function parseTargets(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [namePart, locationPart] = entry.split("=");
      const [host, portText] = String(locationPart || "").split(":");
      const port = Number(portText);

      if (!namePart || !host || !Number.isFinite(port)) {
        throw new Error(`Invalid LOCAL_SERVICE_TARGETS entry: ${entry}`);
      }

      return {
        name: namePart,
        host,
        port
      };
    });
}

function waitForPort({ name, host, port }) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.end();
        console.log(`ready=${name}@${host}:${port}`);
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`timeout=${name}@${host}:${port}`));
          return;
        }

        setTimeout(attempt, retryMs);
      });
    }

    console.log(`waiting_for=${name}@${host}:${port}`);
    attempt();
  });
}

try {
  await Promise.all(targets.map(waitForPort));
  console.log(`local_services_ready=${targets.length}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
