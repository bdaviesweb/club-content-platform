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
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: {
                push: true,
                eventChannels: {
                  submission_review_started: { email: false }
                }
              }
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
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: {
                email: true,
                eventChannels: {
                  submission_published: { email: true }
                }
              }
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
    assert.match(body, /Auto-approve only these content types/);
    assert.match(body, /Never auto-approve these content types/);
    assert.match(body, /Routing rule/);
    assert.match(body, /Content-type routing overrides/);
    assert.match(body, /Photo/);
    assert.match(body, /Video/);
    assert.match(body, /Text/);
    assert.match(body, /Mixed/);
    assert.match(body, /Second approval for public posts/);
    assert.match(body, /Second approver role/);
    assert.match(body, /Second approval content types/);
    assert.match(body, /Default publishing destinations/);
    assert.match(body, /Internal visibility destinations/);
    assert.match(body, /Public visibility destinations/);
    assert.match(body, /Notification email channel/);
    assert.match(body, /Review started email/);
    assert.match(body, /Published push/);
    assert.match(body, /Save club policy/);
    assert.match(body, /Save organization policy/);
    assert.match(body, /Simulate a submission before it hits the queue/);
    assert.match(body, /Hermes suggested approver/);
    assert.match(body, /Preview club draft/);
    assert.match(body, /Preview organization draft/);
    assert.match(body, /Club override/);
    assert.match(body, /Organization default/);
    assert.match(body, /Blocked: video/);
    assert.match(body, /Video -&gt; Team Manager/);
    assert.match(body, /No second public approval requirement is active/);
    assert.match(body, /Publishes to the internal feed by default/);
    assert.match(body, /Channels: email inherit\/default, push enabled/);
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

test("GET /workflow-settings previews unsaved club draft values in the simulator", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
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
              defaultApproverRole: null,
              publicApproverRole: null,
              mediumRiskApproverRole: null,
              allowAgentRouting: null,
              autoApproveInternalLowRisk: null,
              autoApproveMaxRisk: null,
              autoApprovalRule: null,
              routingRule: null,
              approvalRule: null,
              publishingRule: null,
              notificationRule: null
            },
            effectivePolicy: {
              defaultApproverRole: "team_manager",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: {},
              routingRule: {},
              approvalRule: {
                requireSecondApprovalForPublic: true,
                secondApproverRole: "club_admin",
                secondApprovalContentTypes: ["video"]
              },
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: {
                email: true,
                push: true
              }
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
              autoApprovalRule: {},
              routingRule: {},
              approvalRule: {
                requireSecondApprovalForPublic: true,
                secondApproverRole: "club_admin",
                secondApprovalContentTypes: ["video"]
              },
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: {
                email: true,
                push: true
              }
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
            admins: []
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
    const previewDraftPolicy = encodeURIComponent(
      JSON.stringify({
        actorEmail: "comms@westside.test",
        defaultApproverRole: null,
        publicApproverRole: null,
        mediumRiskApproverRole: null,
        allowAgentRouting: false,
        autoApproveInternalLowRisk: true,
        autoApproveMaxRisk: 0.2,
        autoApprovalRule: { allowedContentTypes: ["photo"] },
        routingRule: { contentTypeApprovers: { video: "team_manager" } },
        approvalRule: { requireSecondApprovalForPublic: false },
        publishingRule: { destinations: ["internal_feed"] },
        notificationRule: { email: false, push: true }
      })
    );
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&simulationContentType=video&simulationVisibilityTarget=public&simulationRiskScore=0.2&simulationModerationFlagged=false&previewScopeType=club&previewDraftPolicy=${previewDraftPolicy}`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Previewing unsaved club draft/);
    assert.match(body, /Previewing draft/);
    assert.match(body, /This routes to Team Manager from Routing Rule Content Type/);
    assert.match(body, /This goes through one human approval step before publishing/);
    assert.match(body, /Published email: Disabled \(Notification Policy Email Disabled\)/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings renders a simulated workflow outcome from the effective policy", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
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
              allowAgentRouting: false,
              autoApproveInternalLowRisk: true,
              autoApproveMaxRisk: 0.15,
              autoApprovalRule: { blockedContentTypes: ["video"] },
              routingRule: { contentTypeApprovers: { video: "club_admin" } },
              approvalRule: {
                requireSecondApprovalForPublic: false
              },
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
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: {
                push: true,
                eventChannels: {
                  submission_review_started: { email: false },
                  submission_published: { email: true }
                }
              }
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
              defaultApproverRole: "team_manager"
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
            admins: []
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&simulationContentType=video&simulationVisibilityTarget=public&simulationRiskScore=0.42&simulationModerationFlagged=false`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Expected first approver/);
    assert.match(body, /Club Admin/);
    assert.match(body, /One approval/);
    assert.match(body, /This goes through one human approval step before publishing/);
    assert.match(body, /If approved, this publishes to Internal Feed/);
    assert.match(body, /Review started email: Enabled/);
    assert.match(body, /Published email: Enabled/);
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
          approvalRule: { requireSecondApprovalForPublic: true },
          publishingRule: {
            visibilityDestinations: {
              public: ["internal_feed", "booster_email"]
            }
          },
          notificationRule: {
            email: true,
            eventChannels: {
              submission_review_started: {
                email: false
              }
            }
          }
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
          approvalRule: { requireSecondApprovalForPublic: true },
          publishingRule: {
            visibilityDestinations: {
              public: ["internal_feed", "booster_email"]
            }
          },
          notificationRule: {
            email: true,
            eventChannels: {
              submission_review_started: {
                email: false
              }
            }
          }
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
