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
