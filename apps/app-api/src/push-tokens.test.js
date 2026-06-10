import assert from "node:assert/strict";
import test from "node:test";

import { registerPushToken } from "./push-tokens.js";

function createTransaction({ user } = {}) {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });

      if (String(sql).includes("FROM users")) {
        return user
          ? { rowCount: 1, rows: [user] }
          : { rowCount: 0, rows: [] };
      }

      return { rowCount: 1, rows: [] };
    }
  };

  return {
    queries,
    async withTransaction(fn) {
      return fn(client);
    }
  };
}

test("rejects missing userEmail or installationId", async () => {
  const transaction = createTransaction();

  const result = await registerPushToken({
    body: {
      userEmail: "parent@example.com",
      pushToken: "ExponentPushToken[test]"
    },
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.payload, {
    error: "userEmail and installationId are required"
  });
  assert.equal(transaction.queries.length, 0);
});

test("rejects enabled registrations without a push token", async () => {
  const transaction = createTransaction();

  const result = await registerPushToken({
    body: {
      userEmail: "parent@example.com",
      installationId: "install-1"
    },
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.payload, {
    error: "pushToken is required when enabled is true"
  });
  assert.equal(transaction.queries.length, 0);
});

test("returns not found for unknown users", async () => {
  const transaction = createTransaction();

  const result = await registerPushToken({
    body: {
      userEmail: "missing@example.com",
      installationId: "install-1",
      pushToken: "ExponentPushToken[test]"
    },
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 404);
  assert.deepEqual(result.payload, { error: "Not found" });
  assert.equal(transaction.queries.length, 1);
});

test("writes an upsert audit log for valid enabled registrations", async () => {
  const transaction = createTransaction({
    user: {
      id: "user-1",
      email: "parent@example.com"
    }
  });

  const result = await registerPushToken({
    body: {
      userEmail: " parent@example.com ",
      installationId: "install-1",
      pushToken: "ExponentPushToken[abc123456789]",
      platform: "ios",
      provider: "expo",
      appId: "club-content",
      environment: "production",
      deviceLabel: "ios"
    },
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.registration.userId, "user-1");
  assert.equal(result.payload.registration.userEmail, "parent@example.com");
  assert.equal(result.payload.registration.tokenPreview, "Expone...56789]");
  assert.equal(transaction.queries.length, 2);
  assert.equal(transaction.queries[1].params[1], "push_token.upserted");

  const metadata = JSON.parse(transaction.queries[1].params[2]);
  assert.deepEqual(metadata, {
    push: {
      provider: "expo",
      installationId: "install-1",
      pushToken: "ExponentPushToken[abc123456789]",
      platform: "ios",
      appId: "club-content",
      environment: "production",
      deviceLabel: "ios",
      enabled: true
    }
  });
});

test("writes a revoke audit log for disabled registrations", async () => {
  const transaction = createTransaction({
    user: {
      id: "user-1",
      email: "parent@example.com"
    }
  });

  const result = await registerPushToken({
    body: {
      userEmail: "parent@example.com",
      installationId: "install-1",
      enabled: false
    },
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.registration.enabled, false);
  assert.equal(result.payload.registration.pushToken, null);
  assert.equal(result.payload.registration.tokenPreview, null);
  assert.equal(transaction.queries[1].params[1], "push_token.revoked");

  const metadata = JSON.parse(transaction.queries[1].params[2]);
  assert.equal(metadata.push.enabled, false);
  assert.equal(metadata.push.pushToken, null);
});
