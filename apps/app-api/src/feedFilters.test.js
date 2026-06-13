import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInternalFeedSmokeFilter,
  isSmokeRawText
} from "./feedFilters.js";

test("identifies smoke feed posts by known raw text prefixes", () => {
  assert.equal(isSmokeRawText("approval-publish-smoke-20260612T235237Z"), true);
  assert.equal(isSmokeRawText("hermes-smoke-20260612T154636Z"), true);
  assert.equal(isSmokeRawText("hermes-diagnostic-20260612T161739Z"), true);
  assert.equal(isSmokeRawText("E2E smoke post for Club Content"), true);
  assert.equal(isSmokeRawText("Approval action smoke\nChannels: X"), true);
  assert.equal(isSmokeRawText("Mia scored twice in a 3-1 win."), false);
});

test("builds an internal feed filter that hides smoke posts by default", () => {
  const filter = buildInternalFeedSmokeFilter(false);

  assert.match(filter.clause, /s\.raw_text LIKE \$1/);
  assert.deepEqual(filter.values, [
    "approval-publish-smoke-%",
    "hermes-smoke-%",
    "hermes-diagnostic-%",
    "E2E smoke post%",
    "Approval action smoke%"
  ]);
});

test("skips the smoke filter when explicitly requested", () => {
  assert.deepEqual(buildInternalFeedSmokeFilter(true), {
    clause: "",
    values: []
  });
});
