import assert from "node:assert/strict";
import test from "node:test";

import {
  distanceMeters,
  hashGymVisitToken,
  recordOptumResult,
  registerGymVisit,
  validateGymVisitRequest,
  verifyGymVisitToken
} from "./gym-visits.js";

const token = "shortcut-secret";
const config = {
  enabled: true,
  profileKey: "robert-anytime",
  shortcutTokenHash: hashGymVisitToken(token),
  allowedRadiusMeters: 150,
  minRepeatHours: 12,
  maxClockSkewMinutes: 10,
  optumActionMode: "assist-only",
  gym: {
    slug: "anytime-fitness",
    name: "Anytime Fitness",
    latitude: 44.98,
    longitude: -93.27
  }
};

const validBody = {
  profileKey: "robert-anytime",
  occurredAt: "2026-06-12T12:00:00.000Z",
  deviceLabel: "Robert iPhone",
  shortcutRunId: "shortcut-1",
  location: {
    latitude: 44.9804,
    longitude: -93.2704,
    accuracyMeters: 12
  }
};

function createTransaction({ duplicate = false, missingVisit = false } = {}) {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });

      if (String(sql).includes("INSERT INTO gym_visit_profiles")) {
        return { rowCount: 1, rows: [{ id: "profile-1", profile_key: config.profileKey }] };
      }

      if (String(sql).includes("INSERT INTO gym_locations")) {
        return {
          rowCount: 1,
          rows: [{ id: "gym-1", slug: "anytime-fitness", name: "Anytime Fitness" }]
        };
      }

      if (String(sql).includes("FROM gym_visits") && String(sql).includes("LIMIT 1")) {
        return duplicate
          ? {
              rowCount: 1,
              rows: [{ id: "visit-existing", occurred_at: "2026-06-12T11:00:00.000Z" }]
            }
          : { rowCount: 0, rows: [] };
      }

      if (String(sql).includes("INSERT INTO gym_visit_attempts")) {
        return { rowCount: 1, rows: [{ id: "attempt-1" }] };
      }

      if (String(sql).includes("INSERT INTO gym_visits")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "visit-1",
              occurred_at: validBody.occurredAt,
              optum_action_state: "pending_phone_confirmation"
            }
          ]
        };
      }

      if (String(sql).includes("UPDATE gym_visits")) {
        return missingVisit
          ? { rowCount: 0, rows: [] }
          : {
              rowCount: 1,
              rows: [
                {
                  id: "visit-1",
                  optum_result: params[1],
                  optum_action_state: params[2]
                }
              ]
            };
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

test("hashes and verifies shortcut bearer tokens", () => {
  assert.equal(
    verifyGymVisitToken({
      authorization: `Bearer ${token}`,
      config
    }),
    true
  );

  assert.equal(
    verifyGymVisitToken({
      authorization: "Bearer wrong-token",
      config
    }),
    false
  );
});

test("calculates small distances between nearby coordinates", () => {
  const meters = distanceMeters(
    { latitude: 44.98, longitude: -93.27 },
    { latitude: 44.9804, longitude: -93.2704 }
  );

  assert.ok(meters > 0);
  assert.ok(meters < 70);
});

test("validates accepted on-site check-ins", () => {
  const result = validateGymVisitRequest({
    body: validBody,
    config,
    now: new Date("2026-06-12T12:03:00.000Z")
  });

  assert.equal(result.valid, true);
  assert.equal(result.value.accepted, true);
  assert.equal(result.value.rejectionReason, null);
});

test("rejects outside-geofence check-ins without rejecting the request shape", () => {
  const result = validateGymVisitRequest({
    body: {
      ...validBody,
      location: { latitude: 45.1, longitude: -93.5 }
    },
    config,
    now: new Date("2026-06-12T12:03:00.000Z")
  });

  assert.equal(result.valid, true);
  assert.equal(result.value.accepted, false);
  assert.equal(result.value.rejectionReason, "outside_geofence");
});

test("registers accepted gym visits and returns an Optum phone action", async () => {
  const transaction = createTransaction();

  const result = await registerGymVisit({
    body: validBody,
    authorization: `Bearer ${token}`,
    config,
    now: new Date("2026-06-12T12:03:00.000Z"),
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.accepted, true);
  assert.equal(result.payload.visitId, "visit-1");
  assert.equal(result.payload.optum.action, "open_optum_on_phone");
  assert.equal(result.payload.optum.state, "pending_phone_confirmation");
  assert.ok(transaction.queries.some((query) => String(query.sql).includes("INSERT INTO gym_visits")));
});

test("suppresses duplicate visits inside the repeat window", async () => {
  const transaction = createTransaction({ duplicate: true });

  const result = await registerGymVisit({
    body: validBody,
    authorization: `Bearer ${token}`,
    config,
    now: new Date("2026-06-12T12:03:00.000Z"),
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.accepted, false);
  assert.equal(result.payload.duplicate, true);
  assert.equal(result.payload.rejectionReason, "duplicate_visit_window");
  assert.equal(result.payload.optum.action, "none");
  assert.equal(
    transaction.queries.some((query) => String(query.sql).includes("INSERT INTO gym_visits")),
    false
  );
});

test("requires authorization before registering visits", async () => {
  const transaction = createTransaction();

  const result = await registerGymVisit({
    body: validBody,
    authorization: "Bearer wrong-token",
    config,
    now: new Date("2026-06-12T12:03:00.000Z"),
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 401);
  assert.deepEqual(result.payload, { error: "Unauthorized" });
  assert.equal(transaction.queries.length, 0);
});

test("records Optum result state for accepted visits", async () => {
  const transaction = createTransaction();

  const result = await recordOptumResult({
    body: { visitId: "visit-1", result: "manual_required", note: "Opened phone app" },
    authorization: `Bearer ${token}`,
    config,
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.visit.optum_result, "manual_required");
  assert.equal(result.payload.visit.optum_action_state, "manual_required");
});

test("returns not found when recording Optum result for an unknown visit", async () => {
  const transaction = createTransaction({ missingVisit: true });

  const result = await recordOptumResult({
    body: { visitId: "visit-missing", result: "failed" },
    authorization: `Bearer ${token}`,
    config,
    withTransaction: transaction.withTransaction
  });

  assert.equal(result.status, 404);
  assert.deepEqual(result.payload, { error: "Not found" });
});
