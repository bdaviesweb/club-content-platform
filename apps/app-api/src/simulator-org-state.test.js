import assert from "node:assert/strict";
import test from "node:test";

import {
  getSimulatorOrganizationState,
  repairSimulatorOrganizationStateWithClient,
  validateSimulatorOrganizationState
} from "./simulator-org-state.js";

function createRepairClient() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });

      if (text.includes("SELECT id FROM organizations WHERE slug = $1 LIMIT 1")) {
        return { rows: [{ id: "org-id" }] };
      }

      if (text.includes("SELECT id FROM clubs WHERE slug = $1 LIMIT 1")) {
        return { rows: [{ id: "club-id" }] };
      }

      if (text.includes("RETURNING id") && text.includes("INSERT INTO teams")) {
        return { rows: [{ id: "team-id" }] };
      }

      if (text.includes("RETURNING id") && text.includes("INSERT INTO users")) {
        return { rows: [{ id: `${params[0]}-id` }] };
      }

      return { rows: [] };
    }
  };
}

function createValidationPool(state) {
  return {
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("FROM organizations o") && text.includes("organization_workflow_policies op")) {
        if (text.includes('WHERE o.slug = $1')) {
          return {
            rows: [
              {
                organizationId: "org-id",
                organizationSlug: state.seed.organizationSlug,
                organizationName: state.seed.organizationName,
                orgDefaultApproverRole: state.organizationPolicy.defaultApproverRole,
                orgPublicApproverRole: state.organizationPolicy.publicApproverRole,
                orgMediumRiskApproverRole: state.organizationPolicy.mediumRiskApproverRole,
                orgAllowAgentRouting: state.organizationPolicy.allowAgentRouting,
                orgAutoApproveInternalLowRisk: state.organizationPolicy.autoApproveInternalLowRisk,
                orgAutoApproveMaxRisk: state.organizationPolicy.autoApproveMaxRisk,
                orgAutoApprovalRule: state.organizationPolicy.autoApprovalRule,
                orgRoutingRule: state.organizationPolicy.routingRule,
                orgApprovalRule: state.organizationPolicy.approvalRule,
                orgPublishingRule: state.organizationPolicy.publishingRule,
                orgNotificationRule: state.organizationPolicy.notificationRule
              }
            ]
          };
        }
      }

      if (text.includes("FROM clubs c") && text.includes("LEFT JOIN organization_workflow_policies op")) {
        return {
          rows: [
            {
              clubId: "club-id",
              clubSlug: state.seed.slug,
              clubName: state.seed.name,
              organizationId: "org-id",
              organizationSlug: state.seed.organizationSlug,
              organizationName: state.seed.organizationName,
              orgDefaultApproverRole: state.organizationPolicy.defaultApproverRole,
              orgPublicApproverRole: state.organizationPolicy.publicApproverRole,
              orgMediumRiskApproverRole: state.organizationPolicy.mediumRiskApproverRole,
              orgAllowAgentRouting: state.organizationPolicy.allowAgentRouting,
              orgAutoApproveInternalLowRisk: state.organizationPolicy.autoApproveInternalLowRisk,
              orgAutoApproveMaxRisk: state.organizationPolicy.autoApproveMaxRisk,
              orgAutoApprovalRule: state.organizationPolicy.autoApprovalRule,
              orgRoutingRule: state.organizationPolicy.routingRule,
              orgApprovalRule: state.organizationPolicy.approvalRule,
              orgPublishingRule: state.organizationPolicy.publishingRule,
              orgNotificationRule: state.organizationPolicy.notificationRule,
              clubDefaultApproverRole: state.clubPolicy.defaultApproverRole,
              clubPublicApproverRole: state.clubPolicy.publicApproverRole,
              clubMediumRiskApproverRole: state.clubPolicy.mediumRiskApproverRole,
              clubAllowAgentRouting: state.clubPolicy.allowAgentRouting,
              clubAutoApproveInternalLowRisk: state.clubPolicy.autoApproveInternalLowRisk,
              clubAutoApproveMaxRisk: state.clubPolicy.autoApproveMaxRisk,
              clubAutoApprovalRule: state.clubPolicy.autoApprovalRule,
              clubRoutingRule: state.clubPolicy.routingRule,
              clubApprovalRule: state.clubPolicy.approvalRule,
              clubPublishingRule: state.clubPolicy.publishingRule,
              clubNotificationRule: state.clubPolicy.notificationRule
            }
          ]
        };
      }

      if (text.includes("FROM clubs c") && text.includes("LEFT JOIN club_workflow_policies cp")) {
        return {
          rows: [
            {
              id: "club-id",
              slug: state.seed.slug,
              name: state.seed.name,
              overrideSummary: { overriddenFields: ["Routing Rule", "Approval Rule", "Notification Rule"] }
            }
          ]
        };
      }

      if (text.includes("FROM organization_memberships om")) {
        return {
          rows: [
            {
              role: "organization_admin",
              email: state.seed.organizationAdminEmail,
              fullName: state.seed.organizationAdminName
            }
          ]
        };
      }

      if (text.includes("FROM memberships m")) {
        return {
          rows: [
            { email: state.seed.clubAdminEmail, role: "club_admin" },
            { email: state.seed.approverEmail, role: "club_comms" },
            { email: state.seed.submitterEmail, role: "submitter_coach" },
            { email: state.seed.teamManagerEmail, role: "team_manager" }
          ]
        };
      }

      if (text.includes("FROM clubs c WHERE c.organization_id = $1")) {
        return {
          rows: [
            { id: "club-id", slug: state.seed.slug, name: state.seed.name, overrideSummary: { overriddenFields: [] } }
          ]
        };
      }

      if (text.includes("SELECT id FROM organizations WHERE slug = $1 LIMIT 1")) {
        return { rows: [{ id: "org-id" }] };
      }

      if (text.includes("SELECT id FROM clubs WHERE slug = $1 LIMIT 1")) {
        return { rows: [{ id: "club-id" }] };
      }

      if (text.includes("SELECT id FROM teams WHERE club_id = (SELECT id FROM clubs WHERE slug = $1) AND slug = $2")) {
        return { rows: [{ id: "team-id" }] };
      }

      throw new Error(`Unhandled query: ${text}`);
    }
  };
}

test("repairSimulatorOrganizationStateWithClient canonicalizes the simulator org", async () => {
  const client = createRepairClient();
  const state = getSimulatorOrganizationState();

  await repairSimulatorOrganizationStateWithClient(client);

  assert.match(
    client.calls.map((call) => call.sql).join("\n"),
    /DELETE FROM clubs WHERE organization_id = \$1 AND slug <> \$2/
  );
  assert.match(
    client.calls.map((call) => call.sql).join("\n"),
    /DELETE FROM memberships WHERE club_id = \$1/
  );
  assert.match(
    client.calls.map((call) => call.sql).join("\n"),
    /ON CONFLICT \(organization_id\) DO UPDATE SET/
  );
  assert.match(
    client.calls.map((call) => call.sql).join("\n"),
    /ON CONFLICT \(club_id\) DO UPDATE SET/
  );
  assert.equal(state.seed.organizationSlug, "north-river-youth-sports");
});

test("repairSimulatorOrganizationStateWithClient rejects custom simulator slugs by default", async () => {
  const client = createRepairClient();

  await assert.rejects(
    repairSimulatorOrganizationStateWithClient(client, {
      SIMULATED_PILOT_ORGANIZATION_SLUG: "real-customer-org",
      SIMULATED_PILOT_CLUB_SLUG: "real-customer-club",
      SIMULATED_PILOT_TEAM_SLUG: "real-customer-team"
    }),
    /Refusing to reset simulator organization for custom slugs/
  );

  assert.equal(client.calls.length, 0);
});

test("validateSimulatorOrganizationState accepts the canonical simulator org", async () => {
  const state = getSimulatorOrganizationState();
  const pool = createValidationPool(state);

  const report = await validateSimulatorOrganizationState({
    pool
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.state.organization.slug, "north-river-youth-sports");
  assert.equal(report.state.club.slug, "north-river-soccer-club");
});
