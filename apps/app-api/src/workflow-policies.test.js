import assert from "node:assert/strict";
import test from "node:test";

import {
  loadEffectiveApprovalRuleForClubId,
  loadEffectiveNotificationRuleForClubId,
  loadOrganizationDirectory,
  loadWorkflowPolicyScope,
  updateWorkflowPolicyScope,
  validateWorkflowPolicyPatch
} from "./workflow-policies.js";

test("loads club workflow policies with organization fallback detail", async () => {
  const result = await loadWorkflowPolicyScope(
    {
      async query() {
        return {
          rows: [
            {
              clubId: "club-1",
              clubSlug: "westside",
              clubName: "Westside",
              organizationId: "org-1",
              organizationSlug: "metro",
              organizationName: "Metro",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_admin",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgApprovalRule: {
                requireSecondApprovalForPublic: true,
                secondApproverRole: "club_admin"
              },
              orgPublishingRule: { mode: "org" },
              orgNotificationRule: { email: true },
              clubDefaultApproverRole: "club_admin",
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: false,
              clubAutoApproveInternalLowRisk: true,
              clubAutoApproveMaxRisk: "0.20",
              clubApprovalRule: {},
              clubPublishingRule: {},
              clubNotificationRule: { sms: false }
            }
          ]
        };
      }
    },
    { scopeType: "club", scopeSlug: "westside" }
  );

  assert.equal(result.found, true);
  assert.equal(result.organization.slug, "metro");
  assert.equal(result.club.slug, "westside");
  assert.deepEqual(result.clubPolicy.approvalRule, null);
  assert.deepEqual(result.effectivePolicy.approvalRule, {
    requireSecondApprovalForPublic: true,
    secondApproverRole: "club_admin"
  });
  assert.deepEqual(result.clubPolicy.publishingRule, null);
  assert.deepEqual(result.effectivePolicy.publishingRule, { mode: "org" });
  assert.deepEqual(result.effectivePolicy.notificationRule, { sms: false });
  assert.equal(result.effectivePolicy.defaultApproverRole, "club_admin");
});

test("validates workflow policy patch payloads", () => {
  assert.deepEqual(
    validateWorkflowPolicyPatch(
      {
        defaultApproverRole: "club_admin",
        autoApproveInternalLowRisk: true,
        autoApproveMaxRisk: 0.2
      },
      { scopeType: "club" }
    ),
    {
      ok: true,
      value: {
        defaultApproverRole: "club_admin",
        autoApproveInternalLowRisk: true,
        autoApproveMaxRisk: 0.2
      }
    }
  );

  assert.deepEqual(
    validateWorkflowPolicyPatch(
      { allowAgentRouting: null },
      { scopeType: "organization" }
    ),
    {
      ok: false,
      error: "allowAgentRouting cannot be null for organization policies"
    }
  );

  assert.deepEqual(
    validateWorkflowPolicyPatch(
      {
        approvalRule: {
          requireSecondApprovalForPublic: true,
          secondApproverRole: "club_admin"
        }
      },
      { scopeType: "organization" }
    ),
    {
      ok: true,
      value: {
        approvalRule: {
          requireSecondApprovalForPublic: true,
          secondApproverRole: "club_admin"
        }
      }
    }
  );

  assert.deepEqual(
    validateWorkflowPolicyPatch(
      { approvalRule: { requireSecondApprovalForPublic: "yes" } },
      { scopeType: "club" }
    ),
    {
      ok: false,
      error: "approvalRule.requireSecondApprovalForPublic must be a boolean"
    }
  );

  assert.deepEqual(
    validateWorkflowPolicyPatch(
      { publishingRule: { destinations: ["internal_feed", "booster_email"] } },
      { scopeType: "organization" }
    ),
    {
      ok: true,
      value: {
        publishingRule: { destinations: ["internal_feed", "booster_email"] }
      }
    }
  );

  assert.deepEqual(
    validateWorkflowPolicyPatch(
      { publishingRule: { destinations: ["", "internal_feed"] } },
      { scopeType: "club" }
    ),
    {
      ok: false,
      error: "publishingRule.destinations must contain only non-empty strings"
    }
  );
});

test("updates club workflow policies with authorized actors and preserves clearable overrides", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });

      if (String(sql).includes("FROM clubs c")) {
        if (!calls.some((entry) => entry.sql.includes("INSERT INTO club_workflow_policies"))) {
          return {
            rows: [
              {
                clubId: "club-1",
                clubSlug: "westside",
                clubName: "Westside",
                organizationId: "org-1",
                organizationSlug: "metro",
                organizationName: "Metro",
                orgDefaultApproverRole: "team_manager",
                orgPublicApproverRole: "club_comms",
                orgMediumRiskApproverRole: "club_comms",
                orgAllowAgentRouting: true,
                orgAutoApproveInternalLowRisk: false,
                orgAutoApproveMaxRisk: "0.35",
                orgApprovalRule: {
                  requireSecondApprovalForPublic: true,
                  secondApproverRole: "club_admin"
                },
                orgPublishingRule: { destinations: ["internal_feed"] },
                orgNotificationRule: { email: true },
                clubDefaultApproverRole: null,
                clubPublicApproverRole: null,
                clubMediumRiskApproverRole: null,
                clubAllowAgentRouting: null,
                clubAutoApproveInternalLowRisk: null,
                clubAutoApproveMaxRisk: null,
                clubApprovalRule: {},
                clubPublishingRule: {},
                clubNotificationRule: {}
              }
            ]
          };
        }

        return {
          rows: [
            {
              clubId: "club-1",
              clubSlug: "westside",
              clubName: "Westside",
              organizationId: "org-1",
              organizationSlug: "metro",
              organizationName: "Metro",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_comms",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgApprovalRule: {
                requireSecondApprovalForPublic: true,
                secondApproverRole: "club_admin"
              },
              orgPublishingRule: { destinations: ["internal_feed"] },
              orgNotificationRule: { email: true },
              clubDefaultApproverRole: "club_admin",
              clubPublicApproverRole: null,
              clubMediumRiskApproverRole: null,
              clubAllowAgentRouting: false,
              clubAutoApproveInternalLowRisk: true,
              clubAutoApproveMaxRisk: "0.15",
              clubApprovalRule: { requireSecondApprovalForPublic: false },
              clubPublishingRule: {},
              clubNotificationRule: { push: true }
            }
          ]
        };
      }

      if (String(sql).includes("SELECT id, email FROM users")) {
        return { rowCount: 1, rows: [{ id: "user-1", email: "admin@example.test" }] };
      }

      if (String(sql).includes("FROM memberships")) {
        return { rowCount: 1, rows: [{ role: "club_admin" }] };
      }

      if (String(sql).includes("INSERT INTO club_workflow_policies")) {
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await updateWorkflowPolicyScope(client, {
    scopeType: "club",
    scopeSlug: "westside",
    actorEmail: "admin@example.test",
    patch: {
      defaultApproverRole: "club_admin",
      allowAgentRouting: false,
      autoApproveInternalLowRisk: true,
      autoApproveMaxRisk: 0.15,
      approvalRule: { requireSecondApprovalForPublic: false },
      notificationRule: { push: true }
    }
  });

  const upsert = calls.find((entry) =>
    entry.sql.includes("INSERT INTO club_workflow_policies")
  );

  assert.equal(result.found, true);
  assert.equal(result.clubPolicy.defaultApproverRole, "club_admin");
  assert.deepEqual(result.effectivePolicy.publishingRule, {
    destinations: ["internal_feed"]
  });
  assert.deepEqual(result.clubPolicy.approvalRule, {
    requireSecondApprovalForPublic: false
  });
  assert.deepEqual(result.clubPolicy.notificationRule, { push: true });
  assert.equal(upsert.params[1], "club_admin");
  assert.equal(upsert.params[4], false);
  assert.equal(upsert.params[5], true);
  assert.equal(upsert.params[6], 0.15);
  assert.equal(
    upsert.params[7],
    JSON.stringify({ requireSecondApprovalForPublic: false })
  );
  assert.equal(upsert.params[8], JSON.stringify({}));
});

test("loads organization directory with clubs and organization admins", async () => {
  const calls = [];
  const result = await loadOrganizationDirectory(
    {
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });

        if (String(sql).includes("FROM organizations o")) {
          return {
            rows: [
              {
                organizationId: "org-1",
                organizationSlug: "metro",
                organizationName: "Metro Sports",
                orgDefaultApproverRole: "team_manager",
                orgPublicApproverRole: "club_comms",
                orgMediumRiskApproverRole: "club_comms",
                orgAllowAgentRouting: true,
                orgAutoApproveInternalLowRisk: false,
                orgAutoApproveMaxRisk: "0.35",
                orgApprovalRule: {
                  requireSecondApprovalForPublic: true,
                  secondApproverRole: "club_admin"
                },
                orgPublishingRule: {},
                orgNotificationRule: {}
              }
            ]
          };
        }

        if (String(sql).includes("FROM clubs")) {
          return {
            rows: [
              { id: "club-1", slug: "westside", name: "Westside" },
              { id: "club-2", slug: "eastside", name: "Eastside" }
            ]
          };
        }

        if (String(sql).includes("FROM organization_memberships")) {
          return {
            rows: [
              {
                role: "organization_admin",
                email: "org-admin@example.test",
                fullName: "Org Admin"
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    "metro"
  );

  assert.equal(result.found, true);
  assert.equal(result.organization.slug, "metro");
  assert.equal(result.clubs.length, 2);
  assert.equal(result.admins[0].role, "organization_admin");
  assert.match(calls[1].sql, /FROM clubs/);
  assert.match(calls[2].sql, /FROM organization_memberships/);
});

test("loads effective notification rule for a club id with club override precedence", async () => {
  const result = await loadEffectiveNotificationRuleForClubId(
    {
      async query(sql) {
        if (String(sql).includes("WHERE c.id = $1")) {
          return {
            rows: [
              {
                clubId: "club-1",
                clubSlug: "westside",
                clubName: "Westside",
                organizationId: "org-1",
                organizationSlug: "metro",
                organizationName: "Metro",
                orgDefaultApproverRole: "team_manager",
                orgPublicApproverRole: "club_comms",
                orgMediumRiskApproverRole: "club_admin",
                orgAllowAgentRouting: true,
                orgAutoApproveInternalLowRisk: false,
                orgAutoApproveMaxRisk: "0.35",
                orgApprovalRule: {
                  requireSecondApprovalForPublic: true,
                  secondApproverRole: "club_admin"
                },
                orgPublishingRule: { destinations: ["internal_feed"] },
                orgNotificationRule: { email: true, push: true },
                clubDefaultApproverRole: null,
                clubPublicApproverRole: null,
                clubMediumRiskApproverRole: null,
                clubAllowAgentRouting: null,
                clubAutoApproveInternalLowRisk: null,
                clubAutoApproveMaxRisk: null,
                clubApprovalRule: {},
                clubPublishingRule: {},
                clubNotificationRule: { email: false, push: false }
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    "club-1"
  );

  assert.deepEqual(result, { email: false, push: false });
});

test("loads effective approval rule for a club id with club override precedence", async () => {
  const result = await loadEffectiveApprovalRuleForClubId(
    {
      async query(sql) {
        if (String(sql).includes("WHERE c.id = $1")) {
          return {
            rows: [
              {
                clubId: "club-1",
                clubSlug: "westside",
                clubName: "Westside",
                organizationId: "org-1",
                organizationSlug: "metro",
                organizationName: "Metro",
                orgDefaultApproverRole: "team_manager",
                orgPublicApproverRole: "club_comms",
                orgMediumRiskApproverRole: "club_admin",
                orgAllowAgentRouting: true,
                orgAutoApproveInternalLowRisk: false,
                orgAutoApproveMaxRisk: "0.35",
                orgApprovalRule: {
                  requireSecondApprovalForPublic: true,
                  secondApproverRole: "club_admin"
                },
                orgPublishingRule: { destinations: ["internal_feed"] },
                orgNotificationRule: { email: true, push: true },
                clubDefaultApproverRole: null,
                clubPublicApproverRole: null,
                clubMediumRiskApproverRole: null,
                clubAllowAgentRouting: null,
                clubAutoApproveInternalLowRisk: null,
                clubAutoApproveMaxRisk: null,
                clubApprovalRule: { requireSecondApprovalForPublic: false },
                clubPublishingRule: {},
                clubNotificationRule: { email: false, push: false }
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    "club-1"
  );

  assert.deepEqual(result, { requireSecondApprovalForPublic: false });
});
