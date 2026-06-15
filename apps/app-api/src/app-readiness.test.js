import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppReadinessPayload,
  loadAppReadiness
} from "./app-readiness.js";

const seed = {
  slug: "demo-soccer-club",
  teamSlug: "u14-girls",
  submitterEmail: "coach@demo-club.local",
  approverEmail: "comms@demo-club.local"
};

test("buildAppReadinessPayload exposes demo identities and ready capabilities", () => {
  const payload = buildAppReadinessPayload({
    seed,
    row: {
      club_ready: true,
      team_ready: true,
      submitter_ready: true,
      submitter_membership_ready: true,
      reviewer_ready: true,
      reviewer_membership_ready: true,
      publishing_ready: true
    },
    env: {
      NODE_ENV: "test",
      PUBLIC_PRODUCT_NAME: "Club Content Test",
      S3_ENDPOINT: "http://storage.test",
      RESEND_API_KEY: "resend_test",
      NOTIFICATION_FROM_EMAIL: "club@example.test",
      PUSH_NOTIFICATIONS_ENABLED: "true"
    }
  });

  assert.equal(payload.productName, "Club Content Test");
  assert.deepEqual(payload.demo, {
    clubSlug: "demo-soccer-club",
    teamSlug: "u14-girls",
    submitterEmail: "coach@demo-club.local",
    reviewerEmail: "comms@demo-club.local"
  });
  assert.deepEqual(payload.capabilities, {
    submissions: true,
    review: true,
    publishing: true,
    mediaUploads: true,
    emailNotifications: true,
    pushNotifications: true
  });
  assert.equal(payload.checks.every((check) => check.ok), true);
});

test("buildAppReadinessPayload reports unavailable review separately from submissions", () => {
  const payload = buildAppReadinessPayload({
    seed,
    row: {
      club_ready: true,
      team_ready: true,
      submitter_ready: true,
      submitter_membership_ready: true,
      reviewer_ready: false,
      reviewer_membership_ready: false,
      publishing_ready: true
    },
    env: {}
  });

  assert.equal(payload.capabilities.submissions, true);
  assert.equal(payload.capabilities.review, false);
  assert.equal(payload.capabilities.publishing, true);
  assert.equal(payload.checks.find((check) => check.key === "reviewer_user").ok, false);
});

test("loadAppReadiness queries the seeded demo records", async () => {
  const calls = [];
  const payload = await loadAppReadiness({
    env: {
      DEMO_CLUB_SLUG: "club-a",
      DEMO_TEAM_SLUG: "team-a",
      DEMO_SUBMITTER_EMAIL: "submitter@example.test",
      DEMO_REVIEWER_EMAIL: "reviewer@example.test"
    },
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return {
          rows: [
            {
              club_ready: true,
              team_ready: true,
              submitter_ready: true,
              submitter_membership_ready: true,
              reviewer_ready: true,
              reviewer_membership_ready: true,
              publishing_ready: false
            }
          ]
        };
      }
    }
  });

  assert.deepEqual(calls[0].params.slice(0, 4), [
    "club-a",
    "team-a",
    "submitter@example.test",
    "reviewer@example.test"
  ]);
  assert.equal(payload.demo.reviewerEmail, "reviewer@example.test");
  assert.equal(payload.capabilities.review, true);
  assert.equal(payload.capabilities.publishing, false);
});
