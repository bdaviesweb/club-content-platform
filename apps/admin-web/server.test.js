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

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                action: "workflow_policy.updated",
                createdAt: "2026-06-19T15:20:00.000Z",
                actorEmail: "org-admin@westside.test",
                actorFullName: "Org Admin",
                metadata: {
                  changedFields: ["approvalRule", "notificationRule"]
                }
              }
            ]
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                action: "workflow_policy.updated",
                createdAt: "2026-06-19T16:10:00.000Z",
                actorEmail: "club-admin@westside.test",
                actorFullName: "Club Admin",
                metadata: {
                  changedFields: ["routingRule"]
                }
              }
            ]
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
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Default approver", "Agent routing"]
                }
              },
              {
                slug: "eastside",
                name: "Eastside",
                overrideSummary: {
                  overrideCount: 0,
                  overriddenFields: []
                }
              }
            ],
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
    assert.match(body, /Club view/);
    assert.match(body, /Policy area/);
    assert.match(body, /All policy areas/);
    assert.match(body, /Overrides only/);
    assert.match(body, /Fully inheriting/);
    assert.match(body, /Westside/);
    assert.match(body, /Metro Sports/);
    assert.match(body, /Recent workflow policy changes/);
    assert.match(body, /Club override summary/);
    assert.match(body, /How much this club diverges from the organization/);
    assert.match(body, /Club overrides/);
    assert.match(body, /Inherited areas/);
    assert.match(body, /Default approver/);
    assert.match(body, /Agent routing/);
    assert.match(body, /Low-risk internal auto-approval/);
    assert.match(body, /Auto-approve max risk/);
    assert.match(body, /Notification rule/);
    assert.match(body, /Organization changes/);
    assert.match(body, /Club changes/);
    assert.match(body, /Changed: Approval Rule, Notification Rule/);
    assert.match(body, /Changed: Routing Rule/);
    assert.match(body, /Organization directory/);
    assert.match(body, /Clubs with overrides/);
    assert.match(body, /Fully inheriting/);
    assert.match(body, /Policy area hotspots/);
    assert.match(body, /Review default approver exceptions/);
    assert.match(body, /clubArea=defaultApproverRole/);
    assert.match(body, /Clubs needing exception review/);
    assert.match(body, /Clubs fully inheriting organization defaults/);
    assert.match(body, /Most customized clubs appear first/);
    assert.match(body, /org-admin@westside.test/);
    assert.match(body, /2 override areas/);
    assert.match(body, /Fully inheriting organization defaults/);
    assert.match(body, /Default approver/);
    assert.match(body, /Agent routing/);
    assert.match(body, /Open Westside policy stack/);
    assert.match(body, /Open Eastside policy stack/);
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
    assert.match(body, /Clear club overrides/);
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
      "http://app-api:4000/organizations/metro",
      "http://app-api:4000/workflow-policies/organizations/metro/history",
      "http://app-api:4000/workflow-policies/clubs/westside/history"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings filters the organization directory to clubs with overrides", async () => {
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
              defaultApproverRole: "club_admin",
              allowAgentRouting: false,
              autoApproveInternalLowRisk: true,
              autoApproveMaxRisk: 0.15,
              autoApprovalRule: { blockedContentTypes: ["video"] },
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
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
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
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
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: { email: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Default approver", "Agent routing"]
                }
              },
              {
                slug: "eastside",
                name: "Eastside",
                overrideSummary: {
                  overrideCount: 0,
                  overriddenFields: []
                }
              }
            ],
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&clubView=overrides`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Current view/);
    assert.match(body, /Overrides only/);
    assert.match(body, /Clubs needing exception review/);
    assert.doesNotMatch(body, /Clubs fully inheriting organization defaults/);
    assert.match(body, /Open Westside policy stack/);
    assert.doesNotMatch(body, /Open Eastside policy stack/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings renders a post-save organization rollout summary", async () => {
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
              defaultApproverRole: "club_admin",
              allowAgentRouting: false,
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
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
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
              notificationRule: { push: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/eastside")) {
      return {
        ok: true,
        async json() {
          return {
            club: { slug: "eastside", name: "Eastside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {
              publicApproverRole: "club_admin",
              notificationRule: { email: false }
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
              notificationRule: { email: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Default approver", "Agent routing"]
                }
              },
              {
                slug: "eastside",
                name: "Eastside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Public approver", "Notification rule"]
                }
              }
            ],
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
    const reducingClubs = encodeURIComponent(
      JSON.stringify([
        {
          name: "Westside",
          liveOverrideCount: 7,
          previewOverrideCount: 5
        }
      ])
    );
    const gainingClubs = encodeURIComponent(JSON.stringify([]));
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&saveScopeType=organization&saveChangedAreaCount=2&saveAffectedClubCount=1&saveInsulatedClubCount=1&saveCurrentOverrideClubCount=2&saveProjectedOverrideClubCount=1&saveCurrentOverrideAreaCount=9&saveProjectedOverrideAreaCount=7&saveReducingClubs=${reducingClubs}&saveGainingClubs=${gainingClubs}&saveChangedAreaKeys=publicApproverRole,notificationRule`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Saved organization policy/);
    assert.match(body, /Organization defaults saved with rollout context/);
    assert.match(body, /This save changed 2 organization policy areas\./);
    assert.match(body, /Clubs now inheriting/);
    assert.match(body, /Clubs still insulating/);
    assert.match(body, /Review exceptions/);
    assert.match(body, /Override clubs/);
    assert.match(body, /2 -&gt; 1|2 -> 1/);
    assert.match(body, /Override areas/);
    assert.match(body, /9 -&gt; 7|9 -> 7/);
    assert.match(body, /Override burden/);
    assert.match(body, /Reduced/);
    assert.match(body, /Clubs that got simpler/);
    assert.match(body, /Westside/);
    assert.match(body, /7 -&gt; 5 override areas|7 -> 5 override areas/);
    assert.match(body, /Clubs that got more complex/);
    assert.match(body, /No clubs gained override burden from this save\./);
    assert.match(body, /Review changed areas/);
    assert.match(body, /Review public approver exceptions/);
    assert.match(body, /Review notification rule exceptions/);
    assert.match(body, /clubView=overrides/);
    assert.match(body, /clubArea=publicApproverRole/);
    assert.match(body, /clubArea=notificationRule/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings filters override clubs by policy area", async () => {
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
              defaultApproverRole: "club_admin",
              notificationRule: { push: true }
            },
            effectivePolicy: {
              defaultApproverRole: "club_admin",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: { allowedContentTypes: ["photo"] },
              routingRule: { contentTypeApprovers: { video: "club_admin" } },
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
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: { email: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Default approver", "Notification rule"]
                }
              },
              {
                slug: "northside",
                name: "Northside",
                overrideSummary: {
                  overrideCount: 1,
                  overriddenFields: ["Routing rule"]
                }
              },
              {
                slug: "eastside",
                name: "Eastside",
                overrideSummary: {
                  overrideCount: 0,
                  overriddenFields: []
                }
              }
            ],
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&clubView=overrides&clubArea=notificationRule`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Policy area focus/);
    assert.match(body, /Notification rule/);
    assert.match(body, /Clubs overriding Notification rule/);
    assert.match(body, /Open Westside policy stack/);
    assert.doesNotMatch(body, /Open Northside policy stack/);
    assert.doesNotMatch(body, /Open Eastside policy stack/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings summarizes override hotspots by policy area", async () => {
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
              defaultApproverRole: "club_admin",
              routingRule: { contentTypeApprovers: { video: "team_manager" } }
            },
            effectivePolicy: {
              defaultApproverRole: "club_admin",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: { allowedContentTypes: ["photo"] },
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
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
              notificationRule: { email: true }
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
              notificationRule: { email: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Default approver", "Routing rule"]
                }
              },
              {
                slug: "northside",
                name: "Northside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Default approver", "Notification rule"]
                }
              },
              {
                slug: "southside",
                name: "Southside",
                overrideSummary: {
                  overrideCount: 1,
                  overriddenFields: ["Notification rule"]
                }
              }
            ],
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Policy area hotspots/);
    assert.match(body, /Default approver/);
    assert.match(body, /2 clubs overriding this area/);
    assert.match(body, /Westside/);
    assert.match(body, /Northside/);
    assert.match(body, /Review default approver exceptions/);
    assert.match(body, /clubSlug=westside/);
    assert.match(body, /clubView=overrides/);
    assert.match(body, /clubArea=defaultApproverRole/);
    assert.match(body, /Southside/);
    assert.match(body, /Review notification rule exceptions/);
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

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 0,
                  overriddenFields: []
                }
              }
            ],
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
    assert.match(body, /High-signal save warnings/);
    assert.match(body, /2 flagged/);
    assert.match(
      body,
      /This draft removes the second human approval step for the simulated public submission/
    );
    assert.match(
      body,
      /This draft turns off the published email notification for the simulated submission/
    );
    assert.match(body, /What changes if you save this club draft/);
    assert.match(body, /Live vs draft/);
    assert.match(body, /First approver/);
    assert.match(body, /No change/);
    assert.match(body, /Approval path/);
    assert.match(body, /Live[\s\S]*Two approvals/);
    assert.match(body, /Draft[\s\S]*One approval/);
    assert.match(body, /Published email/);
    assert.match(body, /Live[\s\S]*Enabled/);
    assert.match(body, /Draft[\s\S]*Disabled \(Notification Policy Email Disabled\)/);
    assert.match(body, /Previewing draft/);
    assert.match(body, /data-preview-warning-count="2"/);
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

test("GET /workflow-settings previews organization draft rollout impact", async () => {
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
              defaultApproverRole: "club_admin",
              allowAgentRouting: false,
              autoApproveInternalLowRisk: true,
              autoApproveMaxRisk: 0.15,
              autoApprovalRule: { blockedContentTypes: ["video"] },
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
              approvalRule: null,
              publishingRule: null,
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
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
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
              notificationRule: { push: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/eastside")) {
      return {
        ok: true,
        async json() {
          return {
            club: { slug: "eastside", name: "Eastside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {
              publicApproverRole: "club_admin",
              notificationRule: { email: false }
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
              notificationRule: { email: true }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Default approver", "Agent routing"]
                }
              },
              {
                slug: "eastside",
                name: "Eastside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Public approver", "Notification rule"]
                }
              }
            ],
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
        defaultApproverRole: "team_manager",
        publicApproverRole: "club_admin",
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
        notificationRule: { email: false }
      })
    );
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&previewScopeType=organization&previewDraftPolicy=${previewDraftPolicy}`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Organization rollout impact/);
    assert.match(body, /Which clubs this organization draft will change/);
    assert.match(body, /Changed org areas/);
    assert.match(body, /Clubs affected/);
    assert.match(body, /Clubs insulated/);
    assert.match(body, /Override clubs/);
    assert.match(body, /2 -&gt; 1|2 -> 1/);
    assert.match(body, /Override areas/);
    assert.match(body, /9 -&gt; 7|9 -> 7/);
    assert.match(body, /Override burden/);
    assert.match(body, /Reduced/);
    assert.match(body, /Clubs reducing override burden/);
    assert.match(body, /Eastside reduces 2 override areas under this draft\./);
    assert.match(body, /2 -&gt; 0 override areas|2 -> 0 override areas/);
    assert.match(body, /Clubs gaining override burden/);
    assert.match(body, /No clubs would gain new override burden from this draft\./);
    assert.match(body, /Changed area rollout summary/);
    assert.match(body, /Westside/);
    assert.match(body, /2 impacted areas/);
    assert.match(body, /Inherited from this org draft: Public approver, Notification rule/);
    assert.match(body, /Review public approver rollout/);
    assert.match(body, /Review notification rule rollout/);
    assert.match(body, /clubView=overrides/);
    assert.match(body, /clubArea=publicApproverRole/);
    assert.match(body, /clubArea=notificationRule/);
    assert.match(body, /previewScopeType=organization/);
    assert.match(body, /previewDraftPolicy=/);
    assert.match(body, /Open Westside policy stack/);
    assert.match(body, /Affects 1 club/);
    assert.match(body, /data-preview-affected-club-count="1"/);
    assert.match(body, /data-preview-changed-area-count="2"/);
    assert.match(body, /data-preview-reducing-clubs="[^"]*Eastside[^"]*"/);
    assert.match(body, /data-preview-gaining-clubs="\[\]"/);
    assert.match(body, /Eastside/);
    assert.match(body, /No inherited change/);
    assert.match(body, /This club already overrides every changed organization area: Public approver, Notification rule\./);
    assert.match(body, /Review public approver shielding override/);
    assert.match(body, /Review notification rule shielding override/);
    assert.match(body, /Open Eastside policy stack/);
    assert.match(body, /1 affected \/ 1 insulated/);
    assert.match(body, /Inherited by: Westside/);
    assert.match(body, /Shielded by overrides: Eastside/);
    assert.match(body, /Review public approver across clubs/);
    assert.match(body, /Review notification rule across clubs/);
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

    if (String(url).endsWith("/workflow-policies/organizations/metro/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/westside/history")) {
      return {
        ok: true,
        async json() {
          return { items: [] };
        }
      };
    }

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 0,
                  overriddenFields: []
                }
              }
            ],
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
