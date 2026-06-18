import assert from "node:assert/strict";
import test from "node:test";

import { ensureWorkflowPolicyTables } from "./bootstrap.js";

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
