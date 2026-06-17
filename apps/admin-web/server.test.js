import assert from "node:assert/strict";
import test from "node:test";

import { buildHealthPayload, createAdminServer } from "./server.js";

test("buildHealthPayload returns the admin service shape", () => {
  assert.deepEqual(buildHealthPayload(), {
    service: "admin-web",
    status: "ok"
  });
});

test("GET /health responds without admin auth", async () => {
  const server = createAdminServer();

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "application/json; charset=utf-8"
    );
    assert.deepEqual(await response.json(), {
      service: "admin-web",
      status: "ok"
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
