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
                  changedFields: ["approvalRule", "notificationRule"],
                  changedFieldDetails: [
                    {
                      field: "approvalRule",
                      previousValue: null,
                      nextValue: {
                        requireSecondApprovalForPublic: true
                      }
                    },
                    {
                      field: "notificationRule",
                      previousValue: { email: true },
                      nextValue: { email: true, push: false }
                    }
                  ],
                  rolloutSnapshot: {
                    inheritingClubs: [
                      {
                        slug: "westside",
                        name: "Westside",
                        areas: ["Approval Rule", "Notification Rule"]
                      }
                    ],
                    insulatedClubs: [
                      {
                        slug: "eastside",
                        name: "Eastside",
                        areas: ["Approval Rule", "Notification Rule"]
                      }
                    ]
                  }
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
                  changedFields: ["routingRule"],
                  changedFieldDetails: [
                    {
                      field: "routingRule",
                      previousValue: {},
                      nextValue: {
                        contentTypeApprovers: { video: "team_manager" }
                      }
                    }
                  ],
                  overrideSnapshot: {
                    liveOverrideCount: 0,
                    previewOverrideCount: 1,
                    changedAreas: ["Routing Rule"],
                    addedAreas: ["Routing Rule"],
                    removedAreas: [],
                    retainedAreas: []
                  }
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true&simulationAgentSuggestedApproverRole=club_admin`
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
    assert.match(body, /Changed 2 areas: Approval Rule, Notification Rule/);
    assert.match(body, /Changed 1 area: Routing Rule/);
    assert.match(body, /Review the changed organization areas across clubs, including both remaining exceptions and clubs inheriting the default\./);
    assert.match(body, /Open the club stack to confirm whether these overrides should stay/);
    assert.match(body, /Review approval rule exceptions/);
    assert.match(body, /Review approval rule inheriting clubs/);
    assert.match(body, /Preview rollback of latest org change/);
    assert.match(body, /Preview rollback of approval rule/);
    assert.match(body, /Preview rollback of notification rule/);
    assert.match(body, /Saved rollout snapshot/);
    assert.match(body, /This captures which clubs were inheriting the changed organization areas and which clubs were still insulated by overrides when this save was recorded\./);
    assert.match(body, /Following the saved default/);
    assert.match(body, /Inherited areas: Approval Rule, Notification Rule/);
    assert.match(body, /Still insulated by overrides/);
    assert.match(body, /Still insulated in: Approval Rule, Notification Rule/);
    assert.match(body, /Preview rollback of latest club change/);
    assert.match(body, /Preview rollback of routing rule/);
    assert.match(body, /This restores the earlier club-specific value recorded before this change\./);
    assert.match(body, /Saved override snapshot/);
    assert.match(body, /This captures how customized this club was compared with the organization default when the save was recorded\./);
    assert.match(body, /0 -&gt; 1 override areas|0 -> 1 override areas/);
    assert.match(body, /This save made the club more customized than before\./);
    assert.match(body, /Changed areas/);
    assert.match(body, /Routing Rule/);
    assert.match(body, /New exceptions/);
    assert.match(body, /No existing club-specific exceptions were removed in this save\./);
    assert.match(body, /clubArea=approvalRule/);
    assert.match(body, /clubView=inheriting/);
    assert.match(body, /Open this club policy stack/);
    assert.match(body, /Review approval rule exceptions[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /Review approval rule inheriting clubs[\s\S]*?clubView=inheriting[\s\S]*?clubArea=approvalRule[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /Preview rollback of latest org change/);
    assert.match(body, /previewScopeType=organization/);
    assert.match(body, /previewDraftPolicy=/);
    assert.match(body, /Preview rollback of approval rule[\s\S]*?previewScopeType=organization[\s\S]*?previewDraftPolicy=/);
    assert.match(body, /Preview rollback of notification rule[\s\S]*?previewScopeType=organization[\s\S]*?previewDraftPolicy=/);
    assert.match(body, /previewScopeType=club/);
    assert.match(body, /Open this club policy stack[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /Before: Unset/);
    assert.match(body, /After: \{&quot;requireSecondApprovalForPublic&quot;:true\}/);
    assert.match(body, /Before: \{&quot;email&quot;:true\}/);
    assert.match(body, /After: \{&quot;email&quot;:true,&quot;push&quot;:false\}/);
    assert.match(body, /After: \{&quot;contentTypeApprovers&quot;:\{&quot;video&quot;:&quot;team_manager&quot;\}\}/);
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
    assert.match(body, /clubSlug=westside[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin[\s\S]*?Open Westside policy stack/);
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
    assert.match(body, /Inherit this area/);
    assert.match(body, /data-reset-area-label="Default approver"/);
    assert.match(body, /data-reset-area-fields="[^"]*defaultApproverRole[^"]*"/);
    assert.match(body, /data-reset-area-label="Routing rule"/);
    assert.match(body, /data-reset-area-fields="[^"]*routingRuleApproverVideo[^"]*"/);
    assert.match(body, /data-reset-area-label="Notification rule"/);
    assert.match(body, /data-reset-area-fields="[^"]*notificationRulePublishedPush[^"]*"/);
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
          return {
            items: [
              {
                action: "workflow_policy.updated",
                createdAt: "2026-06-19T16:25:00.000Z",
                actorEmail: "org-admin@westside.test",
                actorFullName: "Org Admin",
                metadata: {
                  changedFields: ["publicApproverRole", "notificationRule"],
                  changedFieldDetails: [
                    {
                      field: "publicApproverRole",
                      previousValue: "club_comms",
                      nextValue: "club_admin"
                    },
                    {
                      field: "notificationRule",
                      previousValue: { email: true, push: true },
                      nextValue: { email: false, push: true }
                    }
                  ],
                  cleanupSummary: {
                    areaKey: "notificationRule",
                    clubs: [
                      { slug: "eastside", name: "Eastside" },
                      { slug: "westside", name: "Westside" }
                    ]
                  },
                  simulationTrace: {
                    scenario: {
                      contentType: "photo",
                      visibilityTarget: "internal",
                      riskScore: 0.19,
                      moderationFlagged: true,
                      agentSuggestedApproverRole: "club_admin"
                    },
                    changedRows: [
                      {
                        key: "publishedEmail",
                        label: "Published email",
                        before: "Enabled",
                        after: "Disabled (Policy Disabled)"
                      }
                    ]
                  }
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
    const saveGuardrailWarnings = encodeURIComponent(
      JSON.stringify([
        {
          title: "Published email disabled",
          areaKey: "notificationRule",
          message: "Published email coverage drops for 1 affected club that inherit this draft."
        }
      ])
    );
    const saveSimulationTrace = encodeURIComponent(
      JSON.stringify({
        scenario: {
          contentType: "photo",
          visibilityTarget: "internal",
          riskScore: 0.19,
          moderationFlagged: true,
          agentSuggestedApproverRole: "club_admin"
        },
        changedRows: [
          {
            key: "publishedEmail",
            label: "Published email",
            before: "Enabled",
            after: "Disabled (Policy Disabled)"
          },
          {
            key: "routing",
            label: "Routing source",
            before: "Local Rules",
            after: "Hermes Agent"
          }
        ]
      })
    );
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&saveScopeType=organization&saveChangedAreaCount=2&saveAffectedClubCount=1&saveInsulatedClubCount=1&saveCurrentOverrideClubCount=2&saveProjectedOverrideClubCount=1&saveCurrentOverrideAreaCount=9&saveProjectedOverrideAreaCount=7&saveReducingClubs=${reducingClubs}&saveGainingClubs=${gainingClubs}&saveGuardrailWarnings=${saveGuardrailWarnings}&saveSimulationTrace=${saveSimulationTrace}&saveChangedAreaKeys=publicApproverRole,notificationRule&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true&simulationAgentSuggestedApproverRole=club_admin`
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
    assert.match(body, /7 -&gt; 5 override areas[\s\S]*?Open Westside policy stack/);
    assert.match(body, /Clubs that got more complex/);
    assert.match(body, /No clubs gained override burden from this save\./);
    assert.match(body, /Remaining exception cleanup/);
    assert.match(body, /These clubs still override one or more organization areas you just changed/);
    assert.match(body, /Bulk cleanup by area/);
    assert.match(body, /Apply org notification rule to selected clubs/);
    assert.match(body, /Eastside/);
    assert.match(body, /Still overriding changed areas: Public approver, Notification rule/);
    assert.match(body, /Preview inheriting public approver/);
    assert.match(body, /Preview inheriting notification rule/);
    assert.match(body, /previewResetArea=notificationRule/);
    assert.match(body, /#policy-area-notificationRule/);
    assert.match(body, /clubSlug=eastside[\s\S]*?previewResetArea=notificationRule[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin[\s\S]*?Preview inheriting notification rule/);
    assert.match(body, /Review changed areas/);
    assert.match(body, /Review public approver exceptions/);
    assert.match(body, /Review public approver inheriting clubs/);
    assert.match(body, /Review notification rule exceptions/);
    assert.match(body, /Review notification rule inheriting clubs/);
    assert.match(body, /clubView=overrides/);
    assert.match(body, /clubView=inheriting/);
    assert.match(body, /clubArea=publicApproverRole/);
    assert.match(body, /clubArea=notificationRule/);
    assert.match(body, /name="simulationContentType"[\s\S]*?<option value="photo" selected/);
    assert.match(body, /name="simulationVisibilityTarget"[\s\S]*?<option value="internal" selected/);
    assert.match(body, /name="simulationRiskScore" type="number" min="0" max="1" step="0.01" value="0.19"/);
    assert.match(body, /name="simulationModerationFlagged"[\s\S]*?<option value="true" selected/);
    assert.match(body, /name="simulationAgentSuggestedApproverRole"[\s\S]*?<option value="club_admin" selected/);
    assert.match(body, /Review public approver exceptions[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /Review public approver inheriting clubs[\s\S]*?clubView=inheriting[\s\S]*?clubArea=publicApproverRole[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /Policy guardrails/);
    assert.match(body, /1 flagged/);
    assert.match(body, /Published email disabled/);
    assert.match(body, /Published email coverage drops for 1 affected club that inherit this draft\./);
    assert.match(body, /clubView=inheriting[\s\S]*?clubArea=notificationRule[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin[\s\S]*?Review notification rule inheriting clubs/);
    assert.match(body, /Rollout snapshot/);
    assert.match(body, /This is the live club-level picture after the saved organization change\./);
    assert.match(body, /Now following the saved default/);
    assert.match(body, /Inherited areas: Public approver, Notification rule/);
    assert.match(body, /Still blocking the rollout with overrides/);
    assert.match(body, /Still insulated in: Public approver, Notification rule/);
    assert.match(body, /Latest recorded field changes/);
    assert.match(body, /These before-and-after values come from the latest recorded organization policy update\./);
    assert.match(body, /Simulated workflow trace for this save/);
    assert.match(body, /This shows how the saved organization change altered the simulated workflow path for the current scenario\./);
    assert.match(body, /Scenario: content Photo/);
    assert.match(body, /visibility Internal/);
    assert.match(body, /risk 0\.19/);
    assert.match(body, /moderation flagged yes/);
    assert.match(body, /Hermes suggested Club Admin/);
    assert.match(body, /Before: Enabled/);
    assert.match(body, /After: Disabled \(Policy Disabled\)/);
    assert.match(body, /Before: Local Rules/);
    assert.match(body, /After: Hermes Agent/);
    assert.match(body, /Before: Club Comms|Before: club_comms/);
    assert.match(body, /After: Club Admin|After: club_admin/);
    assert.match(body, /Before: \{&quot;email&quot;:true,&quot;push&quot;:true\}/);
    assert.match(body, /After: \{&quot;email&quot;:false,&quot;push&quot;:true\}/);
    assert.match(body, /Cleanup staged into this save/);
    assert.match(body, /Notification rule exceptions were cleared for 2 clubs as part of this organization update\./);
    assert.match(body, /Review remaining notification rule exceptions/);
    assert.match(body, /Review inheriting notification rule clubs/);
    assert.match(body, /This captures the saved simulator consequence recorded with this organization policy update\./);
    assert.match(body, /Current rollout state by changed area/);
    assert.match(body, /Use this live view to confirm which clubs are now inheriting each saved organization area and which clubs are still insulating themselves with overrides\./);
    assert.match(body, /1 inheriting \/ 1 insulated/);
    assert.match(body, /Currently inheriting: Westside/);
    assert.match(body, /Still insulated by overrides: Eastside/);
    assert.match(body, /clubSlug=westside[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin[\s\S]*?Open Westside policy stack/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings previews inheriting a single club area from the organization", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/app/readiness")) {
      return {
        ok: true,
        async json() {
          return {
            demo: {
              clubSlug: "eastside",
              reviewerEmail: "comms@eastside.test"
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
            },
            effectivePolicy: {
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
              notificationRule: { email: false, push: true }
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
              notificationRule: { email: true, push: true }
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

    if (String(url).endsWith("/workflow-policies/clubs/eastside/history")) {
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
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=eastside&previewResetArea=notificationRule&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true&simulationAgentSuggestedApproverRole=club_admin`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Previewing unsaved club draft/);
    assert.match(body, /Club exception impact/);
    assert.match(body, /Exceptions removed/);
    assert.match(body, /Notification rule/);
    assert.match(body, /2 -&gt; 1|2 -> 1/);
    assert.match(body, /Review notification rule inheritance/);
    assert.match(body, /Ready to save/);
    assert.match(body, /Jump to this area/);
    assert.match(body, /href="#policy-area-notificationRule"/);
    assert.match(body, /id="policy-area-notificationRule"/);
    assert.match(body, /Reset to live policy[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings renders a post-bulk organization cleanup summary", async () => {
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
              publicApproverRole: "club_admin"
            },
            effectivePolicy: {
              defaultApproverRole: "team_manager",
              publicApproverRole: "club_admin",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: {},
              routingRule: {},
              approvalRule: {},
              publishingRule: {},
              notificationRule: { email: true, push: true }
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
              approvalRule: {},
              publishingRule: {},
              notificationRule: { email: true, push: true }
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
                  overrideCount: 1,
                  overriddenFields: ["Public approver"]
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
    const cleanedClubs = encodeURIComponent(
      JSON.stringify([{ name: "Eastside", slug: "eastside" }])
    );
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&saveScopeType=organization_cleanup&saveCleanupAreaKey=notificationRule&saveCurrentOverrideClubCount=3&saveProjectedOverrideClubCount=2&saveCurrentOverrideAreaCount=8&saveProjectedOverrideAreaCount=6&saveCleanedClubs=${cleanedClubs}&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Bulk exception cleanup saved/);
    assert.match(body, /Notification rule returned to the organization default/);
    assert.match(body, /Clubs cleaned/);
    assert.match(body, /1/);
    assert.match(body, /3 -&gt; 2|3 -> 2/);
    assert.match(body, /8 -&gt; 6|8 -> 6/);
    assert.match(body, /Eastside/);
    assert.match(body, /Review remaining notification rule exceptions/);
    assert.match(body, /Review inheriting notification rule clubs/);
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

test("GET /workflow-settings filters inheriting clubs by policy area", async () => {
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&clubView=inheriting&clubArea=notificationRule`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Policy area focus/);
    assert.match(body, /Notification rule/);
    assert.match(body, /Inheriting this area/);
    assert.match(body, /Clubs inheriting Notification rule/);
    assert.match(body, /Showing clubs still inheriting notification rule from the organization default\./);
    assert.doesNotMatch(body, /Open Westside policy stack/);
    assert.match(body, /Open Northside policy stack/);
    assert.match(body, /Open Eastside policy stack/);
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
    assert.match(body, /Governance watchlist/);
    assert.match(body, /which policy areas are still centralized at the organization level/);
    assert.match(body, /Fragmented/);
    assert.match(body, /2 of 3 clubs are overriding this area\./);
    assert.match(body, /Watchlist/);
    assert.match(body, /1 of 3 clubs is overriding this area\./);
    assert.match(body, /Centralized/);
    assert.match(body, /No clubs are overriding this area right now\./);
    assert.match(body, /Review public approver alignment/);
    assert.match(body, /clubView=inheriting[\s\S]*?clubArea=publicApproverRole[\s\S]*?Review public approver alignment/);
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

test("GET /workflow-settings renders a post-save club exception summary", async () => {
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
              autoApproveMaxRisk: 0.2,
              autoApprovalRule: { allowedContentTypes: ["photo"] },
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
              approvalRule: { requireSecondApprovalForPublic: false },
              publishingRule: { destinations: ["internal_feed"] },
              notificationRule: { email: false, push: true }
            },
            effectivePolicy: {
              defaultApproverRole: "team_manager",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: false,
              autoApproveInternalLowRisk: true,
              autoApproveMaxRisk: 0.2,
              autoApprovalRule: { allowedContentTypes: ["photo"] },
              routingRule: { contentTypeApprovers: { video: "team_manager" } },
              approvalRule: {
                requireSecondApprovalForPublic: false,
                secondApproverRole: "club_admin",
                secondApprovalContentTypes: ["video"]
              },
              publishingRule: { destinations: ["internal_feed"] },
              notificationRule: {
                email: false,
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
          return {
            items: [
              {
                action: "workflow_policy.updated",
                createdAt: "2026-06-19T16:40:00.000Z",
                actorEmail: "club-admin@westside.test",
                actorFullName: "Club Admin",
                metadata: {
                  changedFields: ["allowAgentRouting", "notificationRule"],
                  changedFieldDetails: [
                    {
                      field: "allowAgentRouting",
                      previousValue: null,
                      nextValue: false
                    },
                    {
                      field: "notificationRule",
                      previousValue: null,
                      nextValue: { email: false, push: true }
                    }
                  ]
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
                  overrideCount: 8,
                  overriddenFields: [
                    "Agent routing",
                    "Low-risk internal auto-approval",
                    "Auto-approve max risk",
                    "Auto-approval rule",
                    "Routing rule",
                    "Approval rule",
                    "Publishing rule",
                    "Notification rule"
                  ]
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
    const saveSimulationTrace = encodeURIComponent(
      JSON.stringify({
        scenario: {
          contentType: "photo",
          visibilityTarget: "internal",
          riskScore: 0.19,
          moderationFlagged: true,
          agentSuggestedApproverRole: "club_admin"
        },
        changedRows: [
          {
            key: "publishedEmail",
            label: "Published email",
            before: "Disabled (Notification Policy Email Disabled)",
            after: "Enabled"
          }
        ]
      })
    );
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&saveScopeType=club&saveChangedAreaCount=8&saveCurrentOverrideAreaCount=0&saveProjectedOverrideAreaCount=8&saveChangedAreaKeys=allowAgentRouting,autoApproveInternalLowRisk,autoApproveMaxRisk,autoApprovalRule,routingRule,approvalRule,publishingRule,notificationRule&saveAddedAreaKeys=allowAgentRouting,autoApproveInternalLowRisk,autoApproveMaxRisk,autoApprovalRule,routingRule,approvalRule,publishingRule,notificationRule&saveSimulationTrace=${saveSimulationTrace}&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true&simulationAgentSuggestedApproverRole=club_admin`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Saved club policy/);
    assert.match(body, /Club exceptions saved with change context/);
    assert.match(body, /This save changed 8 club policy areas for Westside\./);
    assert.match(body, /Override areas/);
    assert.match(body, /0 -&gt; 8|0 -> 8/);
    assert.match(body, /New exceptions/);
    assert.match(body, /8/);
    assert.match(body, /Exceptions removed/);
    assert.match(body, /0/);
    assert.match(body, /Override burden/);
    assert.match(body, /Increased/);
    assert.match(body, /Agent routing/);
    assert.match(body, /Low-risk internal auto-approval/);
    assert.match(body, /Auto-approve max risk/);
    assert.match(body, /Auto-approval rule/);
    assert.match(body, /Routing rule/);
    assert.match(body, /Approval rule/);
    assert.match(body, /Publishing rule/);
    assert.match(body, /Notification rule/);
    assert.match(body, /This save did not remove any existing club-specific exceptions\./);
    assert.match(body, /This save did not carry forward any existing club-specific exceptions\./);
    assert.match(body, /Review agent routing exceptions/);
    assert.match(body, /Review notification rule exceptions/);
    assert.match(body, /Review agent routing exceptions[\s\S]*?clubView=overrides[\s\S]*?clubArea=allowAgentRouting[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /Latest recorded field changes/);
    assert.match(body, /These before-and-after values come from the latest recorded club policy update\./);
    assert.match(body, /Simulated workflow trace for this save/);
    assert.match(body, /This shows how the saved club exception change altered the simulated workflow path for the current scenario\./);
    assert.match(body, /Scenario: content Photo/);
    assert.match(body, /visibility Internal/);
    assert.match(body, /risk 0\.19/);
    assert.match(body, /moderation flagged yes/);
    assert.match(body, /Hermes suggested Club Admin/);
    assert.match(body, /Before: Disabled \(Notification Policy Email Disabled\)/);
    assert.match(body, /After: Enabled/);
    assert.match(body, /Before: Unset/);
    assert.match(body, /After: Disabled|After: false/);
    assert.match(body, /After: \{&quot;email&quot;:false,&quot;push&quot;:true\}/);
    assert.match(body, /Run the simulator below against this saved policy/);
    assert.match(body, /name="simulationContentType"[\s\S]*?<option value="photo" selected/);
    assert.match(body, /name="simulationVisibilityTarget"[\s\S]*?<option value="internal" selected/);
    assert.match(body, /name="simulationRiskScore" type="number" min="0" max="1" step="0.01" value="0.19"/);
    assert.match(body, /name="simulationModerationFlagged"[\s\S]*?<option value="true" selected/);
    assert.match(body, /name="simulationAgentSuggestedApproverRole"[\s\S]*?<option value="club_admin" selected/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings highlights when a club exception was removed and returned to inherited defaults", async () => {
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
            clubPolicy: {},
            effectivePolicy: {
              defaultApproverRole: "team_manager",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: {},
              routingRule: {
                contentTypeApprovers: { video: "club_admin" }
              },
              approvalRule: {},
              publishingRule: {},
              notificationRule: { email: true, push: true }
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
              routingRule: {
                contentTypeApprovers: { video: "club_admin" }
              },
              approvalRule: {},
              publishingRule: {},
              notificationRule: { email: true, push: true }
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
          return {
            items: [
              {
                action: "workflow_policy.updated",
                createdAt: "2026-06-19T17:05:00.000Z",
                actorEmail: "club-admin@westside.test",
                actorFullName: "Club Admin",
                metadata: {
                  changedFields: ["routingRule"],
                  changedFieldDetails: [
                    {
                      field: "routingRule",
                      previousValue: { contentTypeApprovers: { video: "team_manager" } },
                      nextValue: null
                    }
                  ]
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&saveScopeType=club&saveChangedAreaCount=1&saveCurrentOverrideAreaCount=1&saveProjectedOverrideAreaCount=0&saveChangedAreaKeys=routingRule&saveRemovedAreaKeys=routingRule&simulationContentType=video&simulationVisibilityTarget=public&simulationRiskScore=0.72&simulationModerationFlagged=false&simulationAgentSuggestedApproverRole=club_admin`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Saved club policy/);
    assert.match(body, /Returned to inherited defaults/);
    assert.match(body, /This save removed the club-specific exception for routing rule, so this club now follows the organization default in that area\./);
    assert.match(body, /Exceptions removed/);
    assert.match(body, /Routing rule/);
    assert.match(body, /Review routing rule inheritance/);
    assert.match(body, /1 -&gt; 0|1 -> 0/);
    assert.match(body, /Reduced/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings keeps changed club areas visible when override burden is unchanged", async () => {
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
              autoApprovalRule: { allowedContentTypes: ["photo"] }
            },
            effectivePolicy: {
              defaultApproverRole: "team_manager",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: { allowedContentTypes: ["photo"] },
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
              autoApprovalRule: { allowedContentTypes: ["photo"] },
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
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&saveScopeType=club&saveChangedAreaCount=1&saveCurrentOverrideAreaCount=0&saveProjectedOverrideAreaCount=0&saveChangedAreaKeys=autoApprovalRule`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Saved club policy/);
    assert.match(body, /Changed policy areas/);
    assert.match(body, /Auto-approval rule/);
    assert.match(body, /This list shows what changed in the saved club layer, even when the club still lines up with the organization default afterward\./);
    assert.match(body, /Override areas/);
    assert.match(body, /0 -&gt; 0|0 -> 0/);
    assert.match(body, /Override burden/);
    assert.match(body, /Unchanged/);
    assert.match(body, /This save did not add any new club-specific exceptions\./);
    assert.match(body, /This save did not remove any existing club-specific exceptions\./);
    assert.match(body, /This save did not carry forward any existing club-specific exceptions\./);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings keeps changed club draft areas visible when preview burden is unchanged", async () => {
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
              autoApprovalRule: null
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
              autoApprovalRule: { allowedContentTypes: ["photo"] },
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
        autoApprovalRule: { allowedContentTypes: ["photo"] }
      })
    );
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&previewScopeType=club&previewDraftPolicy=${previewDraftPolicy}&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true&simulationAgentSuggestedApproverRole=club_admin`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Previewing unsaved club draft/);
    assert.match(body, /Club exception impact/);
    assert.match(body, /Changed policy areas/);
    assert.match(body, /Auto-approval rule/);
    assert.match(body, /This shows what changes in the club layer even when the draft still aligns to the organization default afterward\./);
    assert.match(body, /Override areas/);
    assert.match(body, /0 -&gt; 0|0 -> 0/);
    assert.match(body, /Override burden/);
    assert.match(body, /Unchanged/);
    assert.match(body, /This draft does not add any new club-specific exceptions\./);
    assert.match(body, /This draft does not remove any existing club-specific exceptions\./);
    assert.match(body, /No existing exceptions are being carried forward in this draft\./);
    assert.match(body, /Reset to live policy[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
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
    assert.match(body, /Club exception impact/);
    assert.match(body, /What this club draft changes about local exceptions/);
    assert.match(body, /Override areas/);
    assert.match(body, /0 -&gt; 8|0 -> 8/);
    assert.match(body, /New exceptions/);
    assert.match(body, /8/);
    assert.match(body, /Exceptions removed/);
    assert.match(body, /0/);
    assert.match(body, /Override burden/);
    assert.match(body, /Increased/);
    assert.match(body, /New club exceptions/);
    assert.match(body, /Agent routing/);
    assert.match(body, /Low-risk internal auto-approval/);
    assert.match(body, /Auto-approve max risk/);
    assert.match(body, /Auto-approval rule/);
    assert.match(body, /Routing rule/);
    assert.match(body, /Approval rule/);
    assert.match(body, /Publishing rule/);
    assert.match(body, /Notification rule/);
    assert.match(body, /Exceptions removed[\s\S]*does not remove any existing club-specific exceptions/);
    assert.match(body, /Policy guardrails/);
    assert.match(body, /3 flagged/);
    assert.match(body, /Public second approval removed/);
    assert.match(body, /Internal auto-approval enabled/);
    assert.match(body, /Published email disabled/);
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
    assert.match(body, /data-preview-warning-count="5"/);
    assert.match(body, /This routes to Team Manager from Routing Rule Content Type/);
    assert.match(body, /This goes through one human approval step before publishing/);
    assert.match(body, /Published email: Disabled \(Notification Policy Email Disabled\)/);
    assert.match(body, /Review agent routing exceptions/);
    assert.match(body, /Review notification rule exceptions/);
    assert.match(body, /clubView=overrides[\s\S]*?clubArea=allowAgentRouting[\s\S]*?previewScopeType=club[\s\S]*?previewDraftPolicy=[\s\S]*?simulationContentType=video[\s\S]*?simulationVisibilityTarget=public[\s\S]*?simulationRiskScore=0\.2[\s\S]*?simulationModerationFlagged=false[\s\S]*?Review agent routing exceptions/);
    assert.match(body, /clubView=overrides[\s\S]*?clubArea=notificationRule[\s\S]*?previewScopeType=club[\s\S]*?previewDraftPolicy=[\s\S]*?simulationContentType=video[\s\S]*?simulationVisibilityTarget=public[\s\S]*?simulationRiskScore=0\.2[\s\S]*?simulationModerationFlagged=false[\s\S]*?Review notification rule exceptions/);
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
          return {
            items: [
              {
                action: "workflow_policy.updated",
                actorEmail: "org-admin@westside.test",
                actorFullName: "Org Admin",
                createdAt: "2026-06-19T15:20:00.000Z",
                metadata: {
                  changedFields: ["approvalRule"]
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
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&previewScopeType=organization&previewDraftPolicy=${previewDraftPolicy}&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true&simulationAgentSuggestedApproverRole=club_admin`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Organization rollout impact/);
    assert.match(body, /Which clubs this organization draft will change/);
    assert.match(body, /Changed org areas/);
    assert.match(body, /Clubs affected/);
    assert.match(body, /Clubs insulated/);
    assert.match(body, /Override clubs/);
    assert.match(body, /Override areas/);
    assert.match(body, /Override burden/);
    assert.match(body, /Reduced/);
    assert.match(body, /Policy guardrails/);
    assert.match(body, /1 flagged/);
    assert.match(body, /Published email disabled/);
    assert.match(body, /Published email coverage drops for \d affected club/);
    assert.match(body, /Review notification rule exceptions/);
    assert.match(body, /Review notification rule inheriting clubs/);
    assert.match(body, /clubView=inheriting[\s\S]*?clubArea=notificationRule[\s\S]*?previewScopeType=organization[\s\S]*?previewDraftPolicy=[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin[\s\S]*?Review notification rule inheriting clubs/);
    assert.match(body, /Clubs reducing override burden/);
    assert.match(body, /Eastside[\s\S]*?reduces \d override area/);
    assert.match(body, /override areas[\s\S]*?Open Eastside policy stack/);
    assert.match(body, /Clubs gaining override burden/);
    assert.match(body, /No clubs would gain new override burden from this draft\./);
    assert.match(body, /Exception cleanup priority/);
    assert.match(body, /Bulk cleanup by area/);
    assert.match(body, /These clubs still override at least one organization area changed by this draft/);
    assert.match(body, /Still overriding changed areas:/);
    assert.match(body, /Changed area rollout summary/);
    assert.match(body, /Westside/);
    assert.match(body, /impacted area/);
    assert.match(body, /Inherited from this org draft:/);
    assert.match(body, /Review public approver rollout/);
    assert.match(body, /Review notification rule rollout/);
    assert.match(body, /clubView=overrides/);
    assert.match(body, /clubArea=publicApproverRole/);
    assert.match(body, /clubArea=notificationRule/);
    assert.match(body, /previewScopeType=organization/);
    assert.match(body, /previewDraftPolicy=/);
    assert.match(body, /Open Westside policy stack/);
    assert.match(body, /Affects \d club/);
    assert.match(body, /data-preview-affected-club-count="2"/);
    assert.match(body, /data-preview-changed-area-count="2"/);
    assert.match(body, /data-preview-reducing-clubs="[^"]*Eastside[^"]*"/);
    assert.match(body, /data-preview-gaining-clubs="\[\]"/);
    assert.match(body, /Eastside/);
    assert.match(body, /Open Eastside policy stack/);
    assert.match(body, /1 affected \/ 1 insulated/);
    assert.match(body, /Inherited by:/);
    assert.match(body, /Shielded by overrides:/);
    assert.match(body, /Review public approver across clubs/);
    assert.match(body, /Review notification rule across clubs/);
    assert.match(body, /Review public approver rollout[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /clubSlug=westside[\s\S]*?previewScopeType=organization[\s\S]*?previewDraftPolicy=[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin[\s\S]*?Open Westside policy stack/);
    assert.match(body, /clubSlug=eastside[\s\S]*?previewScopeType=organization[\s\S]*?previewDraftPolicy=[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin[\s\S]*?Open Eastside policy stack/);
    assert.match(body, /Review approval rule exceptions[\s\S]*?previewScopeType=organization[\s\S]*?previewDraftPolicy=[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
    assert.match(body, /Reset to live policy[\s\S]*?simulationContentType=photo[\s\S]*?simulationVisibilityTarget=internal[\s\S]*?simulationRiskScore=0\.19[\s\S]*?simulationModerationFlagged=true[\s\S]*?simulationAgentSuggestedApproverRole=club_admin/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("GET /workflow-settings stages bulk cleanup inside an organization draft preview", async () => {
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
              notificationRule: { email: false, push: false }
            },
            effectivePolicy: {
              defaultApproverRole: "club_admin",
              publicApproverRole: "club_comms",
              mediumRiskApproverRole: "club_comms",
              allowAgentRouting: true,
              autoApproveInternalLowRisk: false,
              autoApproveMaxRisk: 0.35,
              autoApprovalRule: {},
              routingRule: {},
              approvalRule: {},
              publishingRule: {},
              notificationRule: { email: false, push: false }
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
              notificationRule: { email: false, push: false }
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
              approvalRule: {},
              publishingRule: {},
              notificationRule: { email: true, push: true }
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
                slug: "eastside",
                name: "Eastside",
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
    const previewDraftPolicy = encodeURIComponent(
      JSON.stringify({
        actorEmail: "comms@westside.test",
        defaultApproverRole: "team_manager",
        publicApproverRole: "club_comms",
        mediumRiskApproverRole: "club_comms",
        allowAgentRouting: true,
        autoApproveInternalLowRisk: false,
        autoApproveMaxRisk: 0.35,
        autoApprovalRule: {},
        routingRule: {},
        approvalRule: {},
        publishingRule: {},
        notificationRule: { email: false }
      })
    );
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/workflow-settings?clubSlug=westside&previewScopeType=organization&previewDraftPolicy=${previewDraftPolicy}&previewCleanupArea=notificationRule&previewCleanupClubs=westside,eastside&simulationContentType=photo&simulationVisibilityTarget=internal&simulationRiskScore=0.19&simulationModerationFlagged=true`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /data-preview-cleanup-area-key="notificationRule"/);
    assert.match(body, /data-preview-cleanup-club-slugs="westside,eastside"/);
    assert.match(body, /Review notification rule exceptions/);
    assert.match(body, /Review inheriting notification rule clubs|Review notification rule inheriting clubs/);
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

    if (String(url).endsWith("/workflow-policies/clubs/westside") && (init.method || "GET") === "GET") {
      return {
        ok: true,
        async json() {
          return {
            club: { slug: "westside", name: "Westside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {}
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
              approvalRule: {},
              publishingRule: {},
              notificationRule: {}
            }
          };
        }
      };
    }

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
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "GET",
        body: null
      },
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
          },
          historyContext: {
            overrideSnapshot: {
              liveOverrideCount: 0,
              previewOverrideCount: 7,
              changedAreas: [
                "Default approver",
                "Agent routing",
                "Auto-approval rule",
                "Routing rule",
                "Approval rule",
                "Publishing rule",
                "Notification rule"
              ],
              addedAreas: [
                "Default approver",
                "Agent routing",
                "Auto-approval rule",
                "Routing rule",
                "Approval rule",
                "Publishing rule",
                "Notification rule"
              ],
              removedAreas: [],
              retainedAreas: []
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

test("POST /ui/workflow-policies/organizations/:slug proxies policy updates to the API", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null
    });

    if (String(url).endsWith("/workflow-policies/organizations/metro") && (init.method || "GET") === "GET") {
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
              approvalRule: {},
              publishingRule: {},
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
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 0,
                  overriddenFields: []
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
            ]
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          organization: { slug: "metro" },
          organizationPolicy: { defaultApproverRole: "club_comms" }
        };
      }
    };
  };

  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/ui/workflow-policies/organizations/metro`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorEmail: "org-admin@example.test",
          defaultApproverRole: "club_comms",
          publicApproverRole: "club_admin",
          allowAgentRouting: true,
          autoApproveInternalLowRisk: false,
          autoApproveMaxRisk: 0.35,
          approvalRule: {
            requireSecondApprovalForPublic: true,
            secondApproverRole: "club_admin"
          },
          notificationRule: {
            email: true,
            eventChannels: {
              submission_published: {
                email: false,
                push: true
              }
            }
          }
        })
      }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.organization.slug, "metro");
    assert.deepEqual(calls, [
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "POST",
        body: {
          actorEmail: "org-admin@example.test",
          defaultApproverRole: "club_comms",
          publicApproverRole: "club_admin",
          allowAgentRouting: true,
          autoApproveInternalLowRisk: false,
          autoApproveMaxRisk: 0.35,
          approvalRule: {
            requireSecondApprovalForPublic: true,
            secondApproverRole: "club_admin"
          },
          notificationRule: {
            email: true,
            eventChannels: {
              submission_published: {
                email: false,
                push: true
              }
            }
          },
          historyContext: {
            rolloutSnapshot: {
              inheritingClubs: [
                {
                  slug: "westside",
                  name: "Westside",
                  areas: [
                    "Default approver",
                    "Public approver",
                    "Approval rule",
                    "Notification rule"
                  ]
                },
                {
                  slug: "eastside",
                  name: "Eastside",
                  areas: ["Default approver", "Approval rule"]
                }
              ],
              insulatedClubs: [
                {
                  slug: "eastside",
                  name: "Eastside",
                  areas: ["Public approver", "Notification rule"]
                }
              ]
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

test("POST /ui/workflow-policies/organizations/:slug/restore-area restores one organization area from history", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null
    });

    if (String(url).endsWith("/workflow-policies/organizations/metro")) {
      if ((init.method || "GET") === "POST") {
        return {
          ok: true,
          async json() {
            return {
              organization: { slug: "metro" },
              organizationPolicy: {
                defaultApproverRole: "team_manager",
                notificationRule: { email: true }
              }
            };
          }
        };
      }

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
                requireSecondApprovalForPublic: true
              },
              publishingRule: {
                visibilityDestinations: {
                  internal: ["internal_feed"],
                  public: ["internal_feed"]
                }
              },
              notificationRule: { email: false, push: false }
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
            clubs: [
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 1,
                  overriddenFields: ["Default approver"]
                }
              },
              {
                slug: "eastside",
                name: "Eastside",
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

    if (String(url).endsWith("/workflow-policies/clubs/westside")) {
      return {
        ok: true,
        async json() {
          return {
            club: { slug: "westside", name: "Westside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {
              defaultApproverRole: "club_admin"
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
              notificationRule: { email: false }
            }
          };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${init.method || "GET"} ${url}`);
  };

  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/ui/workflow-policies/organizations/metro/restore-area`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorEmail: "org-admin@example.test",
          fieldKey: "notificationRule",
          restoreValue: { email: true },
          returnClubSlug: "westside",
          simulationInput: {
            contentType: "photo",
            visibilityTarget: "internal",
            riskScore: "0.19",
            moderationFlagged: "true",
            agentSuggestedApproverRole: "club_admin"
          }
        })
      }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.match(body.redirectUrl, /saveScopeType=organization/);
    assert.match(body.redirectUrl, /saveChangedAreaKeys=notificationRule/);
    assert.match(body.redirectUrl, /clubSlug=westside/);
    assert.match(body.redirectUrl, /saveSimulationTrace=/);
    assert.deepEqual(calls, [
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/clubs/westside",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/clubs/eastside",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "POST",
        body: {
          actorEmail: "org-admin@example.test",
          notificationRule: { email: true },
          historyContext: {
            simulationTrace: {
              scenario: {
                contentType: "photo",
                visibilityTarget: "internal",
                riskScore: 0.19,
                moderationFlagged: true,
                agentSuggestedApproverRole: "club_admin"
              },
              changedRows: [
                {
                  key: "publishedEmail",
                  label: "Published email",
                  before: "Disabled (Notification Policy Email Disabled)",
                  after: "Enabled"
                },
                {
                  key: "publishedPush",
                  label: "Published push",
                  before: "Disabled (Notification Policy Push Disabled)",
                  after: "Enabled"
                }
              ]
            },
            rolloutSnapshot: {
              inheritingClubs: [
                {
                  slug: "westside",
                  name: "Westside",
                  areas: ["Notification rule"]
                }
              ],
              insulatedClubs: [
                {
                  slug: "eastside",
                  name: "Eastside",
                  areas: ["Notification rule"]
                }
              ]
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

test("POST /ui/workflow-policies/clubs/:slug/restore-area restores one club area from history", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null
    });

    if (String(url).endsWith("/workflow-policies/clubs/westside")) {
      if ((init.method || "GET") === "POST") {
        return {
          ok: true,
          async json() {
            return {
              club: { slug: "westside", name: "Westside" },
              organization: { slug: "metro", name: "Metro Sports" },
              clubPolicy: {
                routingRule: {
                  contentTypeApprovers: { video: "club_admin" }
                }
              }
            };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            club: { slug: "westside", name: "Westside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {
              routingRule: {
                contentTypeApprovers: { video: "team_manager" }
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
              routingRule: {
                contentTypeApprovers: { video: "club_admin" }
              },
              approvalRule: {},
              publishingRule: {},
              notificationRule: {
                email: true,
                push: true
              }
            }
          };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${init.method || "GET"} ${url}`);
  };

  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/ui/workflow-policies/clubs/westside/restore-area`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorEmail: "club-admin@example.test",
          fieldKey: "routingRule",
          restoreValue: {
            contentTypeApprovers: { video: "club_admin" }
          },
          returnClubSlug: "westside",
          simulationInput: {
            contentType: "video",
            visibilityTarget: "public",
            riskScore: "0.72",
            moderationFlagged: "false",
            agentSuggestedApproverRole: "club_admin"
          }
        })
      }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.match(body.redirectUrl, /saveScopeType=club/);
    assert.match(body.redirectUrl, /clubSlug=westside/);
    assert.match(body.redirectUrl, /saveChangedAreaKeys=routingRule/);
    assert.match(body.redirectUrl, /saveAddedAreaKeys=/);
    assert.match(body.redirectUrl, /saveRemovedAreaKeys=/);
    assert.match(body.redirectUrl, /saveRetainedAreaKeys=/);
    assert.match(body.redirectUrl, /saveSimulationTrace=/);
    assert.deepEqual(calls, [
      {
        url: "http://app-api:4000/workflow-policies/clubs/westside",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/clubs/westside",
        method: "POST",
        body: {
          actorEmail: "club-admin@example.test",
          routingRule: {
            contentTypeApprovers: { video: "club_admin" }
          },
          historyContext: {
            simulationTrace: {
              scenario: {
                contentType: "video",
                visibilityTarget: "public",
                riskScore: 0.72,
                moderationFlagged: false,
                agentSuggestedApproverRole: "club_admin"
              },
              changedRows: [
                {
                  key: "approver",
                  label: "First approver",
                  before: "Team Manager",
                  after: "Club Admin"
                }
              ]
            },
            overrideSnapshot: {
              liveOverrideCount: 1,
              previewOverrideCount: 0,
              changedAreas: ["Routing rule"],
              addedAreas: [],
              removedAreas: ["Routing rule"],
              retainedAreas: []
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

test("POST /ui/workflow-policies/organizations/:slug/bulk-inherit-area applies one area across selected clubs", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method, body });

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
              approvalRule: {},
              publishingRule: {},
              notificationRule: { email: true, push: true }
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
            clubs: [
              {
                slug: "eastside",
                name: "Eastside",
                overrideSummary: {
                  overrideCount: 2,
                  overriddenFields: ["Public approver", "Notification rule"]
                }
              },
              {
                slug: "westside",
                name: "Westside",
                overrideSummary: {
                  overrideCount: 1,
                  overriddenFields: ["Notification rule"]
                }
              },
              {
                slug: "northside",
                name: "Northside",
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

    if (String(url).endsWith("/workflow-policies/clubs/eastside") && method === "GET") {
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

    if (String(url).endsWith("/workflow-policies/clubs/westside") && method === "GET") {
      return {
        ok: true,
        async json() {
          return {
            club: { slug: "westside", name: "Westside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {
              notificationRule: { email: false, push: false }
            }
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/clubs/northside") && method === "GET") {
      return {
        ok: true,
        async json() {
          return {
            club: { slug: "northside", name: "Northside" },
            organization: { slug: "metro", name: "Metro Sports" },
            clubPolicy: {}
          };
        }
      };
    }

    if (
      (String(url).endsWith("/workflow-policies/clubs/eastside") ||
        String(url).endsWith("/workflow-policies/clubs/westside")) &&
      method === "POST"
    ) {
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/ui/workflow-policies/organizations/metro/bulk-inherit-area`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorEmail: "org-admin@metro.test",
          areaKey: "notificationRule",
          clubSlugs: ["eastside", "westside", "northside"],
          returnClubSlug: "westside",
          simulationInput: {
            contentType: "photo",
            visibilityTarget: "internal",
            riskScore: "0.19",
            moderationFlagged: "true"
          }
        })
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.match(payload.redirectUrl, /saveScopeType=organization_cleanup/);
    assert.match(payload.redirectUrl, /saveCleanupAreaKey=notificationRule/);
    assert.match(payload.redirectUrl, /clubSlug=westside/);
    assert.match(payload.redirectUrl, /saveCurrentOverrideClubCount=2/);
    assert.match(payload.redirectUrl, /saveProjectedOverrideClubCount=1/);
    assert.match(payload.redirectUrl, /saveCurrentOverrideAreaCount=3/);
    assert.match(payload.redirectUrl, /saveProjectedOverrideAreaCount=1/);
    assert.match(payload.redirectUrl, /clubArea=notificationRule/);

    const clubPosts = calls.filter(
      (call) =>
        call.method === "POST" &&
        /\/workflow-policies\/clubs\/(eastside|westside)$/.test(call.url)
    );
    assert.equal(clubPosts.length, 2);
    assert.deepEqual(
      clubPosts.map((call) => call.body),
      [
        { actorEmail: "org-admin@metro.test", notificationRule: null },
        { actorEmail: "org-admin@metro.test", notificationRule: null }
      ]
    );
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("POST /ui/workflow-policies/organizations/:slug/save-with-cleanup saves org policy and staged club cleanup", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null
    });

    if (String(url).endsWith("/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro", name: "Metro Sports" },
            clubs: [
              { slug: "eastside", name: "Eastside", overrideSummary: { overrideCount: 1, overriddenFields: ["Notification rule"] } },
              { slug: "westside", name: "Westside", overrideSummary: { overrideCount: 1, overriddenFields: ["Notification rule"] } }
            ],
            admins: []
          };
        }
      };
    }

    if (String(url).endsWith("/workflow-policies/organizations/metro")) {
      return {
        ok: true,
        async json() {
          return {
            organization: { slug: "metro" },
            organizationPolicy: { defaultApproverRole: "club_comms" }
          };
        }
      };
    }

    if (
      String(url).endsWith("/workflow-policies/clubs/eastside") ||
      String(url).endsWith("/workflow-policies/clubs/westside")
    ) {
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${init.method || "GET"} ${url}`);
  };

  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/ui/workflow-policies/organizations/metro/save-with-cleanup`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorEmail: "org-admin@example.test",
          defaultApproverRole: "club_comms",
          publicApproverRole: "club_admin",
          historyContext: {
            simulationTrace: {
              scenario: {
                contentType: "photo",
                visibilityTarget: "internal",
                riskScore: 0.19,
                moderationFlagged: true,
                agentSuggestedApproverRole: "club_admin"
              },
              changedRows: [
                {
                  key: "publishedEmail",
                  label: "Published email",
                  before: "Enabled",
                  after: "Disabled (Policy Disabled)"
                }
              ]
            }
          },
          cleanupAreaKey: "notificationRule",
          cleanupClubSlugs: ["eastside", "westside"]
        })
      }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(calls, [
      {
        url: "http://app-api:4000/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/organizations/metro",
        method: "GET",
        body: null
      },
      {
        url: "http://app-api:4000/workflow-policies/organizations/metro",
        method: "POST",
        body: {
          actorEmail: "org-admin@example.test",
          defaultApproverRole: "club_comms",
          publicApproverRole: "club_admin",
          historyContext: {
            simulationTrace: {
              scenario: {
                contentType: "photo",
                visibilityTarget: "internal",
                riskScore: 0.19,
                moderationFlagged: true,
                agentSuggestedApproverRole: "club_admin"
              },
              changedRows: [
                {
                  key: "publishedEmail",
                  label: "Published email",
                  before: "Enabled",
                  after: "Disabled (Policy Disabled)"
                }
              ]
            },
            rolloutSnapshot: {
              inheritingClubs: [
                {
                  slug: "eastside",
                  name: "Eastside",
                  areas: ["Default approver", "Public approver"]
                },
                {
                  slug: "westside",
                  name: "Westside",
                  areas: ["Default approver", "Public approver"]
                }
              ],
              insulatedClubs: []
            },
            cleanupSummary: {
              areaKey: "notificationRule",
              clubs: [
                { slug: "eastside", name: "Eastside" },
                { slug: "westside", name: "Westside" }
              ]
            }
          }
        }
      },
      {
        url: "http://app-api:4000/workflow-policies/clubs/eastside",
        method: "POST",
        body: {
          actorEmail: "org-admin@example.test",
          notificationRule: null
        }
      },
      {
        url: "http://app-api:4000/workflow-policies/clubs/westside",
        method: "POST",
        body: {
          actorEmail: "org-admin@example.test",
          notificationRule: null
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
