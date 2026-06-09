import assert from "node:assert/strict";
import test from "node:test";
import { buildAudienceReviewPackage } from "../src/audience-rewrites.js";

test("buildAudienceReviewPackage keeps analysis core separate from audience rewrites", () => {
  const reviewPackage = buildAudienceReviewPackage({
    rawText: "Huge 3-1 win over Shakopee tonight. Goal from Maya.",
    captionDraft: "Huge 3-1 win over Shakopee tonight. Goal from Maya.",
    analysisSummary: "Low-risk submission. Safe to route for standard internal approval.",
    riskScore: 0.1,
    routingDecision: {
      route: "auto_approve",
      approverRole: "team_manager"
    }
  });

  assert.deepEqual(reviewPackage.analysisCore, {
    summary: "Low-risk submission. Safe to route for standard internal approval.",
    riskScore: 0.1,
    route: "auto_approve",
    approverRole: "team_manager"
  });

  assert.equal(
    reviewPackage.audienceRewrites.parents.caption,
    "Family update: Huge 3-1 win over Shakopee tonight. Goal from Maya."
  );
  assert.equal(
    reviewPackage.audienceRewrites.players.caption,
    "Player spotlight: Huge 3-1 win over Shakopee tonight. Goal from Maya."
  );
  assert.equal(
    reviewPackage.audienceRewrites.coaches.caption,
    "Coach note: Huge 3-1 win over Shakopee tonight. Goal from Maya."
  );
  assert.equal(
    reviewPackage.audienceRewrites.leadership.caption,
    "Club leadership brief: Huge 3-1 win over Shakopee tonight. Goal from Maya."
  );

  for (const rewrite of Object.values(reviewPackage.audienceRewrites)) {
    assert.notEqual(rewrite.caption, reviewPackage.analysisCore.summary);
    assert.equal(rewrite.basedOnCaptionDraft, true);
  }
});
