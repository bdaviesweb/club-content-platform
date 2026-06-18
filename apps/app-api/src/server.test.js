import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";

import { createAppServer } from "./index.js";

async function withServer(run) {
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("GET /health returns service status", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      service: "app-api",
      status: "ok"
    });
  });
});

test("GET /app/readiness returns the injected readiness payload", async () => {
  const calls = [];
  const loadAppReadinessFn = async ({ pool }) => {
    calls.push({ pool });
    return {
      ready: true,
      capabilities: { submissions: true, review: false }
    };
  };
  const pool = { name: "app-readiness-pool" };

  const server = createAppServer({ pool, loadAppReadinessFn });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/app/readiness`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ready: true,
      capabilities: { submissions: true, review: false }
    });
    assert.deepEqual(calls, [{ pool }]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /workflow-policies/clubs/:slug returns club and organization policy detail", async () => {
  const queries = [];
  const pool = {
    async query(query, params) {
      queries.push({ query, params });
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
            orgPublishingRule: { mode: "org" },
            orgNotificationRule: { email: true },
            clubDefaultApproverRole: "club_admin",
            clubPublicApproverRole: null,
            clubMediumRiskApproverRole: null,
            clubAllowAgentRouting: false,
            clubAutoApproveInternalLowRisk: true,
            clubAutoApproveMaxRisk: "0.20",
            clubPublishingRule: {},
            clubNotificationRule: { push: true }
          }
        ]
      };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/workflow-policies/clubs/westside`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.club.slug, "westside");
    assert.equal(body.organization.slug, "metro");
    assert.deepEqual(body.effectivePolicy.publishingRule, { mode: "org" });
    assert.deepEqual(body.clubPolicy.notificationRule, { push: true });
    assert.match(queries[0].query, /FROM clubs c/);
    assert.deepEqual(queries[0].params, ["westside"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /workflow-policies/clubs/:slug updates club policy through the workflow manager flow", async () => {
  const calls = [];
  const runInTransaction = async (fn) =>
    fn({
      async query(query, params = []) {
        calls.push({ query, params });

        if (String(query).includes("FROM clubs c")) {
          if (!calls.some((entry) => String(entry.query).includes("INSERT INTO club_workflow_policies"))) {
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
                  orgPublishingRule: { destinations: ["internal_feed"] },
                  orgNotificationRule: { email: true },
                  clubDefaultApproverRole: null,
                  clubPublicApproverRole: null,
                  clubMediumRiskApproverRole: null,
                  clubAllowAgentRouting: null,
                  clubAutoApproveInternalLowRisk: null,
                  clubAutoApproveMaxRisk: null,
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
                orgPublishingRule: { destinations: ["internal_feed"] },
                orgNotificationRule: { email: true },
                clubDefaultApproverRole: "club_admin",
                clubPublicApproverRole: null,
                clubMediumRiskApproverRole: null,
                clubAllowAgentRouting: false,
                clubAutoApproveInternalLowRisk: true,
                clubAutoApproveMaxRisk: "0.15",
                clubPublishingRule: {},
                clubNotificationRule: { push: true }
              }
            ]
          };
        }

        if (String(query).includes("SELECT id, email FROM users")) {
          return { rowCount: 1, rows: [{ id: "user-1", email: "admin@example.test" }] };
        }

        if (String(query).includes("FROM memberships")) {
          return { rowCount: 1, rows: [{ role: "club_admin" }] };
        }

        if (String(query).includes("INSERT INTO club_workflow_policies")) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unexpected query: ${query}`);
      }
    });

  const server = createAppServer({ runInTransaction });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/workflow-policies/clubs/westside`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorEmail: "admin@example.test",
        defaultApproverRole: "club_admin",
        allowAgentRouting: false,
        autoApproveInternalLowRisk: true,
        autoApproveMaxRisk: 0.15,
        notificationRule: { push: true }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.clubPolicy.defaultApproverRole, "club_admin");
    assert.equal(body.effectivePolicy.allowAgentRouting, false);
    assert.deepEqual(body.effectivePolicy.publishingRule, {
      destinations: ["internal_feed"]
    });

    const upsert = calls.find(({ query }) =>
      String(query).includes("INSERT INTO club_workflow_policies")
    );
    assert.ok(upsert);
    assert.equal(upsert.params[1], "club_admin");
    assert.equal(upsert.params[4], false);
    assert.equal(upsert.params[5], true);
    assert.equal(upsert.params[6], 0.15);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /workflow-policies/organizations/:slug returns organization policy detail", async () => {
  const queries = [];
  const pool = {
    async query(query, params) {
      queries.push({ query, params });
      return {
        rows: [
          {
            organizationId: "org-1",
            organizationSlug: "metro",
            organizationName: "Metro Sports",
            orgDefaultApproverRole: "team_manager",
            orgPublicApproverRole: "club_comms",
            orgMediumRiskApproverRole: "club_admin",
            orgAllowAgentRouting: true,
            orgAutoApproveInternalLowRisk: false,
            orgAutoApproveMaxRisk: "0.35",
            orgPublishingRule: { destinations: ["internal_feed"] },
            orgNotificationRule: { email: true }
          }
        ]
      };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/workflow-policies/organizations/metro`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.organization.slug, "metro");
    assert.equal(body.organizationPolicy.mediumRiskApproverRole, "club_admin");
    assert.deepEqual(body.organizationPolicy.publishingRule, {
      destinations: ["internal_feed"]
    });
    assert.match(queries[0].query, /FROM organizations o/);
    assert.deepEqual(queries[0].params, ["metro"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /organizations/:slug returns organization directory detail", async () => {
  const queries = [];
  const pool = {
    async query(query, params) {
      queries.push({ query, params });

      if (String(query).includes("FROM organizations o")) {
        return {
          rows: [
            {
              organizationId: "org-1",
              organizationSlug: "metro",
              organizationName: "Metro Sports",
              orgDefaultApproverRole: "team_manager",
              orgPublicApproverRole: "club_comms",
              orgMediumRiskApproverRole: "club_admin",
              orgAllowAgentRouting: true,
              orgAutoApproveInternalLowRisk: false,
              orgAutoApproveMaxRisk: "0.35",
              orgPublishingRule: {},
              orgNotificationRule: {}
            }
          ]
        };
      }

      if (String(query).includes("FROM clubs")) {
        return {
          rows: [{ id: "club-1", slug: "westside", name: "Westside" }]
        };
      }

      if (String(query).includes("FROM organization_memberships")) {
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

      throw new Error(`Unexpected query: ${query}`);
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/organizations/metro`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.organization.slug, "metro");
    assert.equal(body.clubs[0].slug, "westside");
    assert.equal(body.admins[0].role, "organization_admin");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /workflow-policies/organizations/:slug updates organization policy through the workflow manager flow", async () => {
  const calls = [];
  const runInTransaction = async (fn) =>
    fn({
      async query(query, params = []) {
        calls.push({ query, params });

        if (String(query).includes("FROM organizations o")) {
          if (!calls.some((entry) => String(entry.query).includes("INSERT INTO organization_workflow_policies"))) {
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
                  orgPublishingRule: { destinations: ["internal_feed"] },
                  orgNotificationRule: { email: true }
                }
              ]
            };
          }

          return {
            rows: [
              {
                organizationId: "org-1",
                organizationSlug: "metro",
                organizationName: "Metro Sports",
                orgDefaultApproverRole: "club_admin",
                orgPublicApproverRole: "club_comms",
                orgMediumRiskApproverRole: "club_comms",
                orgAllowAgentRouting: false,
                orgAutoApproveInternalLowRisk: true,
                orgAutoApproveMaxRisk: "0.20",
                orgPublishingRule: { destinations: ["internal_feed"] },
                orgNotificationRule: { email: true, push: false }
              }
            ]
          };
        }

        if (String(query).includes("SELECT id, email FROM users")) {
          return { rowCount: 1, rows: [{ id: "user-1", email: "admin@example.test" }] };
        }

        if (String(query).includes("FROM organization_memberships")) {
          return { rowCount: 1, rows: [{ role: "organization_admin" }] };
        }

        if (String(query).includes("INSERT INTO organization_workflow_policies")) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unexpected query: ${query}`);
      }
    });

  const server = createAppServer({ runInTransaction });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/workflow-policies/organizations/metro`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorEmail: "admin@example.test",
        defaultApproverRole: "club_admin",
        allowAgentRouting: false,
        autoApproveInternalLowRisk: true,
        autoApproveMaxRisk: 0.2,
        notificationRule: { email: true, push: false }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.organizationPolicy.defaultApproverRole, "club_admin");
    assert.equal(body.organizationPolicy.allowAgentRouting, false);

    const upsert = calls.find(({ query }) =>
      String(query).includes("INSERT INTO organization_workflow_policies")
    );
    assert.ok(upsert);
    assert.equal(upsert.params[1], "club_admin");
    assert.equal(upsert.params[4], false);
    assert.equal(upsert.params[5], true);
    assert.equal(upsert.params[6], 0.2);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /missing returns not found", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: "Not found" });
  });
});

test("GET /workflow-events defaults to failed events and returns items", async () => {
  const rows = [
    {
      id: "event-1",
      submission_id: "submission-1",
      event_name: "submission_publish_failed",
      processing_error: "publish adapter failed"
    }
  ];
  const queries = [];

  const pool = {
    async query(query) {
      queries.push(query);
      return { rows };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/workflow-events`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { items: rows });
    assert.equal(queries.length, 1);
    assert.match(
      queries[0],
      /WHERE processed_at IS NOT NULL AND processing_error IS NOT NULL/
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /approvals/queue returns approval queue items", async () => {
  const rows = [
    {
      id: "approval-1",
      state: "pending",
      submission_id: "submission-1",
      approverRole: "club_admin",
      latest_review_summary: "Looks good"
    }
  ];
  const queries = [];

  const pool = {
    async query(query) {
      queries.push(query);
      return { rows };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/approvals/queue`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { items: rows });
    assert.equal(queries.length, 1);
    assert.match(queries[0], /FROM approval_requests ar/);
    assert.match(queries[0], /WHERE ar\.state = 'pending'/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /approval-requests/:id returns approval request detail", async () => {
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://clubcontent-api.example.test";

  const rows = [
    {
      id: "approval-1",
      state: "pending",
      media: [{ id: "media-1", objectKey: "uploads/approval.jpg" }]
    }
  ];
  const queries = [];

  const pool = {
    async query(query) {
      queries.push(query);
      return { rowCount: 1, rows };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/approval-requests/approval-1`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      id: "approval-1",
      state: "pending",
      media: [
        {
          id: "media-1",
          objectKey: "uploads/approval.jpg",
          previewUrl:
            "https://clubcontent-api.example.test/media/preview?key=uploads%2Fapproval.jpg"
        }
      ]
    });
    assert.equal(queries.length, 1);
    assert.match(queries[0], /FROM approval_requests ar/);
    assert.match(queries[0], /WHERE ar\.id = \$1/);
  } finally {
    server.close();
    await once(server, "close");
    if (previousPublicAppUrl === undefined) {
      delete process.env.PUBLIC_APP_URL;
    } else {
      process.env.PUBLIC_APP_URL = previousPublicAppUrl;
    }
  }
});

test("GET /approval-requests/:id returns not found when missing", async () => {
  const pool = {
    async query() {
      return { rowCount: 0, rows: [] };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/approval-requests/missing-approval`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: "Not found" });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /submissions validates submitterEmail", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/submissions`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: "submitterEmail is required" });
  });
});

test("GET /submissions returns filtered submission items", async () => {
  const rows = [
    {
      id: "submission-1",
      content_type: "photo",
      raw_text: "Great save",
      visibility_target: "internal",
      status: "received",
      risk_score: null,
      created_at: "2026-06-18T12:00:00.000Z",
      club_slug: "westside",
      team_slug: "u12-boys",
      media_count: 2
    }
  ];
  const calls = [];
  const pool = {
    async query(query, params) {
      calls.push({ query, params });
      return { rows };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(
      `${baseUrl}/submissions?submitterEmail=parent%40example.test&clubSlug=westside&teamSlug=u12-boys&limit=99`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { items: rows });
    assert.equal(calls.length, 1);
    assert.match(calls[0].query, /FROM submissions s/);
    assert.deepEqual(calls[0].params, [
      "parent@example.test",
      "westside",
      "u12-boys",
      25
    ]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /submissions/:id returns the loaded submission record", async () => {
  const calls = [];
  const submission = {
    id: "submission-1",
    status: "approved_internal",
    media: [{ id: "media-1", previewUrl: "https://example.test/media-1" }]
  };
  const loadSubmissionRecordFn = async (input) => {
    calls.push(input);
    return submission;
  };
  const pool = { name: "submission-pool" };

  const server = createAppServer({ pool, loadSubmissionRecordFn });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/submissions/submission-1`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, submission);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pool, pool);
    assert.equal(calls[0].submissionId, "submission-1");
    assert.equal(typeof calls[0].enrichMediaCollection, "function");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /submissions/:id returns not found when the record is missing", async () => {
  const loadSubmissionRecordFn = async () => null;

  const server = createAppServer({ loadSubmissionRecordFn });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/submissions/missing-submission`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: "Not found" });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /submissions validates required fields", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submitterEmail: "parent@example.test" })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, {
      error: "clubSlug, submitterEmail, and contentType are required"
    });
  });
});

test("POST /submissions creates a submission and media rows", async () => {
  const calls = [];
  const createSubmissionRunInTransaction = async (fn) =>
    fn({
      async query(query, params) {
        calls.push({ query, params });

        if (query.includes("SELECT id FROM clubs")) {
          return { rowCount: 1, rows: [{ id: "club-1" }] };
        }

        if (query.includes("SELECT id FROM users")) {
          return { rowCount: 1, rows: [{ id: "user-1" }] };
        }

        if (query.includes("SELECT id FROM teams")) {
          return { rowCount: 1, rows: [{ id: "team-1" }] };
        }

        if (query.includes("INSERT INTO submissions")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "submission-1",
                club_id: "club-1",
                team_id: "team-1",
                submitted_by_user_id: "user-1",
                content_type: "photo",
                raw_text: "Big win",
                visibility_target: "internal",
                status: "received"
              }
            ]
          };
        }

        if (
          query.includes("INSERT INTO submission_media") ||
          query.includes("INSERT INTO submission_events")
        ) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unexpected query: ${query}`);
      }
    });

  const server = createAppServer({ createSubmissionRunInTransaction });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clubSlug: "westside",
        teamSlug: "u12-boys",
        submitterEmail: "parent@example.test",
        contentType: "photo",
        rawText: "Big win",
        media: [
          {
            objectKey: "uploads/photo.jpg",
            mediaType: "image",
            mimeType: "image/jpeg",
            width: 1200,
            height: 900
          }
        ]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(body, {
      submission: {
        id: "submission-1",
        club_id: "club-1",
        team_id: "team-1",
        submitted_by_user_id: "user-1",
        content_type: "photo",
        raw_text: "Big win",
        visibility_target: "internal",
        status: "received"
      }
    });
    assert.equal(calls.length, 6);
    assert.match(calls[0].query, /SELECT id FROM clubs/);
    assert.match(calls[1].query, /SELECT id FROM users/);
    assert.match(calls[2].query, /SELECT id FROM teams/);
    assert.match(calls[3].query, /INSERT INTO submissions/);
    assert.match(calls[4].query, /INSERT INTO submission_media/);
    assert.match(calls[5].query, /INSERT INTO submission_events/);
    assert.deepEqual(calls[0].params, ["westside"]);
    assert.deepEqual(calls[1].params, ["parent@example.test"]);
    assert.deepEqual(calls[2].params, ["club-1", "u12-boys"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /media/preview validates upload keys", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/media/preview?key=bad/path.jpg`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: "A valid media key is required" });
  });
});

test("GET /media/preview returns stored object bytes", async () => {
  const calls = [];
  const getStoredObjectFn = async (objectKey) => {
    calls.push(objectKey);
    return {
      Body: Buffer.from("preview-bytes"),
      ContentType: "image/jpeg"
    };
  };

  const server = createAppServer({ getStoredObjectFn });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(
      `${baseUrl}/media/preview?key=uploads%2Fphoto.jpg`
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body, "preview-bytes");
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    assert.deepEqual(calls, ["uploads/photo.jpg"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /submissions/:id/resubmit validates submitterEmail", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/submissions/submission-1/resubmit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawText: "Updated caption" })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: "submitterEmail is required" });
  });
});

test("POST /submissions/:id/resubmit resets the submission for review", async () => {
  const calls = [];
  const resubmitSubmissionRunInTransaction = async (fn) =>
    fn({
      async query(query, params) {
        calls.push({ query, params });

        if (query.includes("FROM submissions s") && query.includes("FOR UPDATE")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "submission-1",
                submitter_email: "parent@example.test",
                status: "needs_metadata",
                raw_text: "Old caption",
                visibility_target: "internal"
              }
            ]
          };
        }

        if (query.includes("SELECT id FROM users")) {
          return { rowCount: 1, rows: [{ id: "user-1" }] };
        }

        if (
          query.includes("UPDATE submissions") ||
          query.includes("DELETE FROM submission_media") ||
          query.includes("INSERT INTO submission_media") ||
          query.includes("INSERT INTO submission_events") ||
          query.includes("INSERT INTO audit_logs")
        ) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unexpected query: ${query}`);
      }
    });

  const server = createAppServer({ resubmitSubmissionRunInTransaction });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/submissions/submission-1/resubmit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        submitterEmail: "parent@example.test",
        rawText: "Updated caption",
        visibilityTarget: "public",
        media: [
          {
            objectKey: "uploads/resubmitted.jpg",
            mediaType: "image",
            mimeType: "image/jpeg"
          }
        ]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      submission: { id: "submission-1", status: "received" }
    });
    assert.equal(calls.length, 7);
    assert.match(calls[0].query, /FROM submissions s/);
    assert.match(calls[1].query, /SELECT id FROM users/);
    assert.match(calls[2].query, /UPDATE submissions/);
    assert.match(calls[3].query, /DELETE FROM submission_media/);
    assert.match(calls[4].query, /INSERT INTO submission_media/);
    assert.match(calls[5].query, /INSERT INTO submission_events/);
    assert.match(calls[6].query, /INSERT INTO audit_logs/);
    assert.deepEqual(calls[0].params, ["submission-1"]);
    assert.deepEqual(calls[1].params, ["parent@example.test"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /workflow-events/:id/retry validates actorEmail", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/workflow-events/event-1/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "try again" })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: "actorEmail is required" });
  });
});

test("POST /workflow-events/:id/retry resets the event and records the retry", async () => {
  const calls = [];
  const runInTransaction = async (fn) =>
    fn({
      async query(query, params) {
        calls.push({ query, params });

        if (query.includes("SELECT id FROM users")) {
          return { rowCount: 1, rows: [{ id: "user-1" }] };
        }

        if (query.includes("FROM submission_events") && query.includes("FOR UPDATE")) {
          return {
            rowCount: 1,
            rows: [
              {
                event_name: "submission_publish_failed",
                submission_id: "submission-1",
                processing_error: "publish adapter failed"
              }
            ]
          };
        }

        if (query.includes("UPDATE submission_events")) {
          return { rowCount: 1, rows: [] };
        }

        if (query.includes("INSERT INTO audit_logs")) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unexpected query: ${query}`);
      }
    });

  const server = createAppServer({ runInTransaction });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/workflow-events/event-1/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorEmail: "coach@example.test",
        notes: "Retry after config fix"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      eventId: "event-1",
      eventName: "submission_publish_failed",
      submissionId: "submission-1",
      reset: true
    });
    assert.equal(calls.length, 4);
    assert.match(calls[0].query, /SELECT id FROM users/);
    assert.match(calls[1].query, /FROM submission_events/);
    assert.match(calls[2].query, /UPDATE submission_events/);
    assert.match(calls[3].query, /INSERT INTO audit_logs/);
    assert.deepEqual(calls[0].params, ["coach@example.test"]);
    assert.deepEqual(calls[2].params, ["event-1"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /approval-requests/:id/actions validates required fields", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/approval-requests/approval-1/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "missing fields" })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: "action and actedByEmail are required" });
  });
});

test("POST /approval-requests/:id/actions approves and enqueues the approved event", async () => {
  const calls = [];
  const approvalActorCalls = [];
  const approvalActionRunInTransaction = async (fn) =>
    fn({
      async query(query, params) {
        calls.push({ query, params });
        return { rowCount: 1, rows: [] };
      }
    });

  const loadApprovalActor = async (_client, approvalRequestId, actedByEmail) => {
    approvalActorCalls.push({ approvalRequestId, actedByEmail });
    return {
      found: true,
      authorized: true,
      actor: { id: "user-1" },
      approvalRequest: {
        submission_id: "submission-1",
        submitted_by_user_id: "submitter-1"
      }
    };
  };

  let notificationCalled = false;
  const deliverNotification = async () => {
    notificationCalled = true;
  };

  const server = createAppServer({
    approvalActionRunInTransaction,
    loadApprovalActor,
    deliverNotification
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/approval-requests/approval-1/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        actedByEmail: "reviewer@example.test",
        notes: "Looks ready"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      approvalRequestId: "approval-1",
      submissionId: "submission-1",
      action: "approve",
      stage: "primary",
      nextStage: null
    });
    assert.deepEqual(approvalActorCalls, [
      {
        approvalRequestId: "approval-1",
        actedByEmail: "reviewer@example.test"
      }
    ]);
    assert.equal(calls.length, 5);
    assert.match(calls[0].query, /UPDATE approval_requests/);
    assert.match(calls[1].query, /INSERT INTO approval_actions/);
    assert.match(calls[2].query, /UPDATE submissions/);
    assert.match(calls[3].query, /INSERT INTO submission_events/);
    assert.match(calls[4].query, /INSERT INTO audit_logs/);
    assert.equal(notificationCalled, false);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /approval-requests/:id/actions applies club notification policy to submitter updates", async () => {
  const approvalActorCalls = [];
  const notificationCalls = [];
  const approvalActionRunInTransaction = async (fn) =>
    fn({
      async query(query, params) {
        if (String(query).includes("WHERE c.id = $1")) {
          return {
            rowCount: 1,
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
                orgPublishingRule: {},
                orgNotificationRule: { email: true, push: true },
                clubDefaultApproverRole: null,
                clubPublicApproverRole: null,
                clubMediumRiskApproverRole: null,
                clubAllowAgentRouting: null,
                clubAutoApproveInternalLowRisk: null,
                clubAutoApproveMaxRisk: null,
                clubPublishingRule: {},
                clubNotificationRule: { email: false, push: false }
              }
            ]
          };
        }

        return { rowCount: 1, rows: [] };
      }
    });

  const loadApprovalActor = async (_client, approvalRequestId, actedByEmail) => {
    approvalActorCalls.push({ approvalRequestId, actedByEmail });
    return {
      found: true,
      authorized: true,
      actor: { id: "user-1" },
      approvalRequest: {
        submission_id: "submission-1",
        submitted_by_user_id: "submitter-1",
        club_id: "club-1"
      }
    };
  };

  const deliverNotification = async (_client, payload) => {
    notificationCalls.push(payload);
  };

  const server = createAppServer({
    approvalActionRunInTransaction,
    loadApprovalActor,
    deliverNotification
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/approval-requests/approval-1/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "request_changes",
        actedByEmail: "reviewer@example.test",
        notes: "Please remove player names."
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      approvalRequestId: "approval-1",
      submissionId: "submission-1",
      action: "request_changes",
      stage: "primary",
      nextStage: null
    });
    assert.deepEqual(approvalActorCalls, [
      {
        approvalRequestId: "approval-1",
        actedByEmail: "reviewer@example.test"
      }
    ]);
    assert.equal(notificationCalls.length, 1);
    assert.deepEqual(notificationCalls[0].notificationPolicy, {
      email: false,
      push: false
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /approval-requests/:id/actions creates a secondary approval for public submissions when policy requires it", async () => {
  const calls = [];
  const approvalActorCalls = [];
  const approvalRuleCalls = [];
  const approvalActionRunInTransaction = async (fn) =>
    fn({
      async query(query, params = []) {
        calls.push({ query: String(query), params });

        if (String(query).includes("FROM memberships")) {
          return {
            rowCount: 1,
            rows: [{ id: "user-2", role: "club_admin" }]
          };
        }

        return { rowCount: 1, rows: [] };
      }
    });

  const loadApprovalActor = async (_client, approvalRequestId, actedByEmail) => {
    approvalActorCalls.push({ approvalRequestId, actedByEmail });
    return {
      found: true,
      authorized: true,
      actor: { id: "user-1" },
      approvalRequest: {
        submission_id: "submission-2",
        submitted_by_user_id: "submitter-2",
        club_id: "club-1",
        team_id: null,
        visibility_target: "public",
        stage: "primary"
      }
    };
  };

  const loadApprovalRuleForClubId = async (_client, clubId) => {
    approvalRuleCalls.push(clubId);
    return {
      requireSecondApprovalForPublic: true,
      secondApproverRole: "club_admin"
    };
  };

  let notificationCalled = false;
  const deliverNotification = async () => {
    notificationCalled = true;
  };

  const server = createAppServer({
    approvalActionRunInTransaction,
    loadApprovalActor,
    loadApprovalRuleForClubId,
    deliverNotification
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/approval-requests/approval-2/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        actedByEmail: "reviewer@example.test",
        notes: "Primary approval complete"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      approvalRequestId: "approval-2",
      submissionId: "submission-2",
      action: "approve",
      stage: "primary",
      nextStage: "secondary"
    });
    assert.deepEqual(approvalActorCalls, [
      {
        approvalRequestId: "approval-2",
        actedByEmail: "reviewer@example.test"
      }
    ]);
    assert.deepEqual(approvalRuleCalls, ["club-1"]);

    const submissionUpdate = calls.find(({ query }) =>
      query.includes("UPDATE submissions")
    );
    assert.equal(submissionUpdate.params[1], "needs_human_review");

    const secondaryInsert = calls.find(({ query }) =>
      query.includes("INSERT INTO approval_requests")
    );
    assert.ok(secondaryInsert);
    assert.deepEqual(secondaryInsert.params, [
      "submission-2",
      "user-2",
      "club_admin"
    ]);

    const secondaryEvent = calls.find(
      ({ query, params }) =>
        query.includes("INSERT INTO submission_events") &&
        params[1] === "submission.approval.requested"
    );
    assert.deepEqual(JSON.parse(secondaryEvent.params[2]), {
      stage: "secondary",
      approverRole: "club_admin",
      originallyRequestedRole: "club_admin",
      previousApprovalRequestId: "approval-2"
    });
    assert.equal(notificationCalled, false);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /notifications validates userEmail", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/notifications`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: "userEmail is required" });
  });
});

test("GET /notifications returns recent notification items", async () => {
  const rows = [
    {
      id: "notification-1",
      type: "submission_review_started",
      payload: { submissionId: "submission-1" },
      readAt: null,
      createdAt: "2026-06-18T12:00:00.000Z",
      deliveryStatus: "email.delivered",
      deliveryProviderId: "email-1",
      deliveryUpdatedAt: "2026-06-18T12:01:00.000Z"
    }
  ];
  const calls = [];
  const pool = {
    async query(query, params) {
      calls.push({ query, params });
      return { rows };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(
      `${baseUrl}/notifications?userEmail=parent%40example.test&limit=50`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { items: rows });
    assert.equal(calls.length, 1);
    assert.match(calls[0].query, /FROM notifications n/);
    assert.deepEqual(calls[0].params, ["parent@example.test", 25]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /notifications/:id/read marks the notification as read", async () => {
  const calls = [];
  const pool = {
    async query(query, params) {
      calls.push({ query, params });
      return {
        rowCount: 1,
        rows: [{ id: "notification-1", readAt: "2026-06-18T12:05:00.000Z" }]
      };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/notifications/notification-1/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userEmail: "parent@example.test" })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      id: "notification-1",
      readAt: "2026-06-18T12:05:00.000Z"
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].query, /UPDATE notifications n/);
    assert.deepEqual(calls[0].params, ["notification-1", "parent@example.test"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /push-tokens returns masked active push registrations", async () => {
  const rows = [
    {
      userId: "user-1",
      userEmail: "parent@example.test",
      provider: "expo",
      installationId: "installation-1",
      pushToken: "ExponentPushToken[abcdef1234567890]",
      platform: "ios",
      appId: "com.hermes.clubcontent",
      environment: "development",
      deviceLabel: "Parent iPhone",
      enabled: true,
      updatedAt: "2026-06-18T12:00:00.000Z"
    }
  ];
  const calls = [];
  const pool = {
    async query(query, params) {
      calls.push({ query, params });
      return { rows };
    }
  };

  const server = createAppServer({ pool });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(
      `${baseUrl}/push-tokens?userEmail=parent%40example.test`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      items: [
        {
          ...rows[0],
          tokenPreview: "Expone...67890]"
        }
      ]
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].query, /WITH latest_push_state AS/);
    assert.deepEqual(calls[0].params, ["parent@example.test"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /push-tokens delegates to registerPushToken with the app provider", async () => {
  const registerCalls = [];
  const registerPushTokenFn = async (input) => {
    registerCalls.push(input);
    return {
      status: 200,
      payload: {
        registration: {
          userId: "user-1",
          provider: input.defaultProvider,
          installationId: input.body.installationId
        }
      }
    };
  };

  const server = createAppServer({ registerPushTokenFn });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/push-tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userEmail: "parent@example.test",
        installationId: "installation-1",
        pushToken: "ExponentPushToken[abcdef1234567890]"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      registration: {
        userId: "user-1",
        provider: "expo",
        installationId: "installation-1"
      }
    });
    assert.equal(registerCalls.length, 1);
    assert.equal(registerCalls[0].body.userEmail, "parent@example.test");
    assert.equal(registerCalls[0].defaultProvider, "expo");
    assert.equal(typeof registerCalls[0].withTransaction, "function");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /notification-delivery/status returns the injected delivery snapshot", async () => {
  const buildCalls = [];
  const buildNotificationDeliveryStatusFn = (config) => {
    buildCalls.push(config);
    return {
      email: { enabled: false, mode: "log-only" },
      push: { enabled: false, mode: "disabled" }
    };
  };

  const server = createAppServer({ buildNotificationDeliveryStatusFn });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/notification-delivery/status`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      email: { enabled: false, mode: "log-only" },
      push: { enabled: false, mode: "disabled" }
    });
    assert.equal(buildCalls.length, 1);
    assert.equal(buildCalls[0].resendWebhookEndpointPath, "/webhooks/resend");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("GET /feed/internal returns filtered feed items with enriched media state", async () => {
  const rows = [
    {
      id: "post-1",
      published_at: "2026-06-18T12:30:00.000Z",
      submission_id: "submission-1",
      raw_text: "Goal recap",
      caption_draft: "A strong finish",
      content_type: "photo",
      visibility_target: "internal",
      risk_score: 0.1,
      routing_decision: "auto_publish_internal",
      destination_name: "Internal Feed",
      media: [
        { objectKey: "uploads/goal.jpg", mediaType: "image", mimeType: "image/jpeg" },
        { objectKey: "uploads/clip.mov", mediaType: "video", mimeType: "video/quicktime" }
      ]
    }
  ];
  const queryCalls = [];
  const enrichCalls = [];
  const pool = {
    async query(query, params) {
      queryCalls.push({ query, params });
      return { rows };
    }
  };
  const enrichFeedMediaCollectionFn = async (media) => {
    enrichCalls.push(media);
    return {
      displayableMedia: [{ objectKey: "uploads/goal.jpg", previewUrl: "https://example.test/goal.jpg" }],
      unavailableMedia: [{ objectKey: "uploads/clip.mov", mimeType: "video/quicktime", previewUrl: null, previewUnavailableReason: "unsupported_format" }]
    };
  };

  const server = createAppServer({ pool, enrichFeedMediaCollectionFn });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/feed/internal?includeSmoke=1`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      items: [
        {
          ...rows[0],
          media: [{ objectKey: "uploads/goal.jpg", previewUrl: "https://example.test/goal.jpg" }],
          unavailable_media_count: 1,
          unavailable_media_reasons: [
            {
              objectKey: "uploads/clip.mov",
              mimeType: "video/quicktime",
              reason: "unsupported_format"
            }
          ]
        }
      ]
    });
    assert.equal(queryCalls.length, 1);
    assert.match(queryCalls[0].query, /FROM published_posts pp/);
    assert.deepEqual(queryCalls[0].params, []);
    assert.deepEqual(enrichCalls, [rows[0].media]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("POST /webhooks/resend records verified webhook deliveries", async () => {
  const parseCalls = [];
  const recordCalls = [];
  const parseWebhook = ({ rawBody, headers }) => {
    parseCalls.push({ rawBody, headers });
    return {
      ok: true,
      verified: true,
      event: { type: "email.delivered", data: { email_id: "email-1" } }
    };
  };
  const runInTransaction = async (fn) => fn({ name: "client" });
  const recordWebhookEvent = async (client, payload) => {
    recordCalls.push({ client, payload });
    return {
      verified: payload.verified,
      webhookType: payload.event.type,
      matchedNotificationId: "notification-1",
      emailId: payload.event.data.email_id
    };
  };

  const server = createAppServer({
    parseWebhook,
    recordWebhookEvent,
    runInTransaction
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/webhooks/resend`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_123"
      },
      body: JSON.stringify({ type: "email.delivered" })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      received: true,
      verified: true,
      webhookType: "email.delivered",
      matchedNotificationId: "notification-1",
      emailId: "email-1"
    });
    assert.equal(parseCalls.length, 1);
    assert.match(parseCalls[0].rawBody, /email\.delivered/);
    assert.equal(parseCalls[0].headers["svix-id"], "msg_123");
    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].client.name, "client");
    assert.equal(recordCalls[0].payload.verified, true);
  } finally {
    server.close();
    await once(server, "close");
  }
});
