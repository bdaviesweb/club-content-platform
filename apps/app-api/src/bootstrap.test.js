import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureWorkflowPolicyTables,
  getClubSeed,
  getSimulatedPilotSeed
} from "./bootstrap.js";

test("ensureWorkflowPolicyTables upgrades existing workflow policy tables in place", async () => {
  const queries = [];

  await ensureWorkflowPolicyTables({
    async query(sql) {
      queries.push(String(sql));
      return { rowCount: 0, rows: [] };
    }
  });

  const orgUpgrade = queries.find((sql) =>
    sql.includes("ALTER TABLE organization_workflow_policies")
  );
  const clubUpgrade = queries.find((sql) =>
    sql.includes("ALTER TABLE club_workflow_policies")
  );
  const orgMembershipTable = queries.find((sql) =>
    sql.includes("CREATE TABLE IF NOT EXISTS organization_memberships")
  );

  assert.match(orgUpgrade, /ADD COLUMN IF NOT EXISTS default_approver_role/);
  assert.match(orgUpgrade, /ADD COLUMN IF NOT EXISTS auto_approve_max_risk/);
  assert.match(orgUpgrade, /ADD COLUMN IF NOT EXISTS auto_approval_rule/);
  assert.match(orgUpgrade, /ADD COLUMN IF NOT EXISTS routing_rule/);
  assert.match(orgUpgrade, /ADD COLUMN IF NOT EXISTS approval_rule/);
  assert.match(orgUpgrade, /ADD COLUMN IF NOT EXISTS notification_rule/);

  assert.match(clubUpgrade, /ADD COLUMN IF NOT EXISTS default_approver_role/);
  assert.match(clubUpgrade, /ADD COLUMN IF NOT EXISTS auto_approve_internal_low_risk/);
  assert.match(clubUpgrade, /ADD COLUMN IF NOT EXISTS auto_approval_rule/);
  assert.match(clubUpgrade, /ADD COLUMN IF NOT EXISTS routing_rule/);
  assert.match(clubUpgrade, /ADD COLUMN IF NOT EXISTS approval_rule/);
  assert.match(clubUpgrade, /ADD COLUMN IF NOT EXISTS publishing_rule/);
  assert.match(clubUpgrade, /ADD COLUMN IF NOT EXISTS notification_rule/);
  assert.match(orgMembershipTable, /organization_membership_role/);
});

test("getClubSeed keeps demo defaults and Expo fallback", () => {
  const seed = getClubSeed({
    EXPO_PUBLIC_SUBMITTER_EMAIL: "expo-submitter@example.test"
  });

  assert.equal(seed.organizationSlug, "demo-sports-org");
  assert.equal(seed.submitterEmail, "expo-submitter@example.test");
  assert.equal(seed.ageGroup, "U14");
});

test("getSimulatedPilotSeed exposes the multi-role simulated pilot defaults", () => {
  const seed = getSimulatedPilotSeed();

  assert.equal(seed.organizationSlug, "north-river-youth-sports");
  assert.equal(seed.slug, "north-river-soccer-club");
  assert.equal(seed.teamSlug, "u13-girls-blue");
  assert.equal(seed.ageGroup, "U13");
  assert.equal(seed.clubAdminEmail, "admin@northriverpilot.local");
  assert.equal(seed.teamManagerEmail, "manager@northriverpilot.local");
});
