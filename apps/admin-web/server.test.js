import assert from "node:assert/strict";
import test from "node:test";

import { buildHealthPayload, createAdminServer } from "./server.js";

test("buildHealthPayload returns the admin service shape", () => {
  assert.deepEqual(buildHealthPayload(), {
    service: "admin-web",
    status: "ok"
  });
});

test("GET /health responds without admin auth", async () => {
  const server = createAdminServer();

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "application/json; charset=utf-8"
    );
    assert.deepEqual(await response.json(), {
      service: "admin-web",
      status: "ok"
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings renders policy controls for the selected club", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));

    if (String(url).endsWith("/app/readiness")) {
      return {
        ok: true,
        async json() {
          return {
            demo: {
              clubSlug: "westside",
              reviewerEmail: "comms@westside.test"
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside")) {
      return {
        ok: true,
        async json() {
          return {
            club: { slug: "westside", name: "Westside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {
              defaultApproverRole: "club_admin",
              allowAgentRouting: false,
              autoApproveInternalLowRisk: true,
              autoApproveMaxRisk: 0.15,
              autoApprovalRule: { blockedContentTypes: ["video"] },
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
              approvalRule: { requireSecondApprovalForPublic: false },
              publishingRule: {},
              notificationRule: { push: true }
            },
            effectivePolicy: {
              defaultApproverRole: "club_admin",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: false,
              autoApproveInternalLowRisk: true,
              autoApproveMaxRisk: 0.15,
              autoApprovalRule: { blockedContentTypes: ["video"] },
              routingRule: {
                contentTypeApprovers: { video: "club_admin" }
              },
              approvalRule: {
                requireSecondApprovalForPublic: true,
                secondApproverRole: "club_admin",
                secondApprovalContentTypes: ["video"]
              },
              publishingRule: { destinations: ["internal_feed"] },
              notificationRule: { push: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            organizationPolicy: {
              defaultApproverRole: "team_manager",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: { allowedContentTypes: ["photo"] },
              routingRule: { contentTypeApprovers: { video: "club_admin" } },
              publishingRule: { destinations: ["internal_feed"] },
              notificationRule: { email: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [{ slug: "westside", name: "Westside" }],
            admins: [
              {
                role: "organization_admin",
                email: "org-admin@westside.test",
                fullName: "Org Admin"
              }
            ]
          };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Workflow settings/);
    assert.match(body, /Set routing rules by club or by organization/);
    assert.match(body, /Westside/);
    assert.match(body, /Metro Sports/);
    assert.match(body, /Organization directory/);
    assert.match(body, /org-admin@westside.test/);
    assert.match(body, /Auto-approval rule/);
    assert.match(body, /allowedContentTypes/);
    assert.match(body, /Routing rule/);
    assert.match(body, /contentTypeApprovers/);
    assert.match(body, /Approval rule/);
    assert.match(body, /requireSecondApprovalForPublic/);
    assert.match(body, /secondApprovalContentTypes/);
    assert.match(body, /Save club policy/);
    assert.match(body, /Save organization policy/);
    assert.deepEqual(calls, [
      "http://app-api:4000/app/readiness",
      "http://app-api:4000/workflow-policies/clubs/westside",
      "http://app-api:4000/workflow-policies/organizations/metro",
      "http://app-api:4000/organizations/metro"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("POST /ui/workflow-policies/clubs/:slug proxies policy updates to the API", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null
    });

    return {
      ok: true,
      async json() {
        return {
          club: { slug: "westside" },
          clubPolicy: { defaultApproverRole: "club_admin" }
        };
      }
    };
  };

  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/ui/workflow-policies/clubs/westside`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorEmail: "admin@example.test",
          defaultApproverRole: "club_admin",
          allowAgentRouting: false,
          autoApprovalRule: { allowedContentTypes: ["photo"] },
          routingRule: { contentTypeApprovers: { video: "team_manager" } },
          approvalRule: { requireSecondApprovalForPublic: true }
        })
      }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.club.slug, "westside");
    assert.deepEqual(calls, [
      {
        url: "http://app-api:4000/workflow-policies/clubs/westside",
        method: "POST",
        body: {
          actorEmail: "admin@example.test",
          defaultApproverRole: "club_admin",
          allowAgentRouting: false,
          autoApprovalRule: { allowedContentTypes: ["photo"] },
          routingRule: { contentTypeApprovers: { video: "team_manager" } },
          approvalRule: { requireSecondApprovalForPublic: true }
        }
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
