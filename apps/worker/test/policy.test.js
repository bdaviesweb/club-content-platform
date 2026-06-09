import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CLUB_POLICY,
  evaluateClubRouting,
  mergeClubPolicy
} from "../src/policy.js";

test("mergeClubPolicy preserves defaults while applying overrides", () => {
  const merged = mergeClubPolicy({
    routing: { publishMainFeedByDefault: false },
    review: { autoApproveMaxRisk: 0.05 },
    channels: [{ key: "instagram", label: "Instagram", favorite: true, allowed: true }]
  });

  assert.equal(merged.routing.publishMainFeedByDefault, false);
  assert.equal(merged.review.autoApproveMaxRisk, 0.05);
  assert.equal(merged.channels.length, 1);
});

test("evaluateClubRouting auto-approves low-risk content on allowed channels", () => {
  const result = evaluateClubRouting(
    {
      raw_text: "Big win tonight\nChannels: Instagram, Facebook",
      selected_channels: ["instagram", "facebook"],
      content_type: "photo",
      visibility_target: "internal"
    },
    {
      riskScore: 0.1,
      summary: "Low risk"
    },
    DEFAULT_CLUB_POLICY
  );

  assert.equal(result.route, "auto_approve");
  assert.equal(result.publishMainFeedByDefault, true);
  assert.deepEqual(result.policyHits.channels, []);
  assert.deepEqual(result.blockedChannels, []);
  assert.ok(result.recommendedChannels.some((channel) => channel.key === "instagram"));
});

test("evaluateClubRouting routes blocked or risky content to human review", () => {
  const result = evaluateClubRouting(
    {
      raw_text: "Please send to X\nInjury update from the match",
      selected_channels: ["x"],
      content_type: "video",
      visibility_target: "public"
    },
    {
      riskScore: 0.12,
      summary: "Needs review"
    },
    DEFAULT_CLUB_POLICY
  );

  assert.equal(result.route, "human_review");
  assert.equal(result.approverRole, "club_comms");
  assert.deepEqual(result.policyHits.channels, ["X"]);
  assert.deepEqual(result.policyHits.keywords.sort(), ["injury"]);
  assert.deepEqual(result.policyHits.contentType, ["video"]);
  assert.ok(result.blockedChannels.some((channel) => channel.key === "x"));
});
