import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const runningInDockerExec = process.env.RUNNING_IN_DOCKER_EXEC === "1";
const apiBaseUrl = process.env.API_BASE_URL || (runningInDockerExec ? "http://app-api:4000" : "http://localhost:4000");
const adminBaseUrl = process.env.ADMIN_BASE_URL || (runningInDockerExec ? "http://localhost:3001" : "http://localhost:3001");
const clubSlug = process.env.E2E_CLUB_SLUG || "demo-soccer-club";
const actorEmail =
  process.env.E2E_SETTINGS_ACTOR_EMAIL ||
  process.env.ADMIN_SETTINGS_ACTOR_EMAIL ||
  process.env.DEMO_ADMIN_EMAIL ||
  "admin@demo-club.local";
const basicAuthUser = process.env.ADMIN_BASIC_AUTH_USER || "";
const basicAuthPassword = process.env.ADMIN_BASIC_AUTH_PASSWORD || "";

function buildHeaders(initHeaders = {}) {
  const headers = new Headers(initHeaders);
  if (basicAuthUser && basicAuthPassword) {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${basicAuthUser}:${basicAuthPassword}`).toString("base64")}`
    );
  }
  return headers;
}

async function waitForUrl(url, label, { timeoutMs = 60000, intervalMs = 1000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: buildHeaders({ accept: "application/json" })
      });
      if (response.ok) {
        return response;
      }
      lastError = new Error(`${label} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError || new Error(`${label} did not become ready`);
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(init.headers || {})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${url} failed: ${response.status} ${text}`);
  }
  return response.text();
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: buildHeaders({
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers || {})
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${url} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function main() {
  await waitForUrl(`${apiBaseUrl}/health`, "API health");
  await waitForUrl(`${adminBaseUrl}/policy?clubSlug=${encodeURIComponent(clubSlug)}&actorEmail=${encodeURIComponent(actorEmail)}`, "admin policy page");

  const policyPage = await fetchText(
    `${adminBaseUrl}/policy?clubSlug=${encodeURIComponent(clubSlug)}&actorEmail=${encodeURIComponent(actorEmail)}`
  );
  assert.match(policyPage, /Workspace rules, without JSON\./);
  assert.match(policyPage, /Club members/);
  assert.match(policyPage, /Membership activity/);

  const policyPayload = await fetchJson(`${apiBaseUrl}/clubs/${encodeURIComponent(clubSlug)}/workflow-policy`);
  assert.ok(policyPayload.config, "workflow policy payload missing config");
  assert.ok(Array.isArray(policyPayload.config.channels), "workflow policy channels missing");

  const membershipPayload = await fetchJson(
    `${apiBaseUrl}/clubs/${encodeURIComponent(clubSlug)}/memberships?actorEmail=${encodeURIComponent(actorEmail)}`
  );
  assert.equal(membershipPayload.actor?.canView, true, "actor should be able to view memberships");
  assert.ok(
    Array.isArray(membershipPayload.memberships) && membershipPayload.memberships.length > 0,
    "membership roster missing"
  );

  const savedPolicy = await fetchJson(`${adminBaseUrl}/ui/policy/${encodeURIComponent(clubSlug)}`, {
    method: "POST",
    body: JSON.stringify({
      policyKey: policyPayload.policyKey || "default",
      config: policyPayload.config
    })
  });
  assert.equal(savedPolicy.policyKey, policyPayload.policyKey || "default");
  assert.deepEqual(savedPolicy.config, policyPayload.config);

  const savedMemberships = await fetchJson(
    `${adminBaseUrl}/ui/memberships/${encodeURIComponent(clubSlug)}`,
    {
      method: "POST",
      body: JSON.stringify({
        actorEmail,
        memberships: membershipPayload.memberships
      })
    }
  );
  assert.equal(savedMemberships.memberships.length, membershipPayload.memberships.length);
  assert.equal(savedMemberships.actor?.email, actorEmail.toLowerCase());
  assert.equal(savedMemberships.actor?.canView, true);

  const refreshedPolicy = await fetchJson(`${apiBaseUrl}/clubs/${encodeURIComponent(clubSlug)}/workflow-policy`);
  const refreshedMemberships = await fetchJson(
    `${apiBaseUrl}/clubs/${encodeURIComponent(clubSlug)}/memberships?actorEmail=${encodeURIComponent(actorEmail)}`
  );

  assert.equal(refreshedPolicy.policyKey, policyPayload.policyKey || "default");
  assert.deepEqual(refreshedPolicy.config, policyPayload.config);
  assert.equal(refreshedMemberships.memberships.length, membershipPayload.memberships.length);

  process.stdout.write(
    JSON.stringify(
      {
        clubSlug,
        actorEmail,
        policyKey: refreshedPolicy.policyKey,
        membershipCount: refreshedMemberships.memberships.length,
        pageChecked: true,
        policyRoundTrip: true,
        membershipsRoundTrip: true
      },
      null,
      2
    ) + "\n"
  );
}

if (runningInDockerExec) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
} else {
  const scriptSource = await fs.readFile(new URL(import.meta.url), "utf8");
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "club-content-admin-web",
      "env",
      "RUNNING_IN_DOCKER_EXEC=1",
      `E2E_CLUB_SLUG=${clubSlug}`,
      `E2E_SETTINGS_ACTOR_EMAIL=${actorEmail}`,
      basicAuthUser ? `ADMIN_BASIC_AUTH_USER=${basicAuthUser}` : null,
      basicAuthPassword ? `ADMIN_BASIC_AUTH_PASSWORD=${basicAuthPassword}` : null,
      "API_BASE_URL=http://app-api:4000",
      "ADMIN_BASE_URL=http://localhost:3001",
      "node"
    ].filter(Boolean),
    {
      input: scriptSource,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    }
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}
