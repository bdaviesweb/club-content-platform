import assert from "node:assert/strict";
import test from "node:test";

import { formatRoutingSourceLabel } from "../../admin-web/routingLabels.js";

test("formats queue routing sources for admin review cards", () => {
  assert.equal(formatRoutingSourceLabel("hermes_agent"), "Hermes");
  assert.equal(formatRoutingSourceLabel("local_rules"), "Local rules");
  assert.equal(formatRoutingSourceLabel("fallback_router"), "Fallback Router");
});
