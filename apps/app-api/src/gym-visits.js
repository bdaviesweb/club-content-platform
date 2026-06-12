import crypto from "node:crypto";

const DEFAULT_ALLOWED_RADIUS_METERS = 150;
const DEFAULT_MIN_REPEAT_HOURS = 12;
const DEFAULT_MAX_CLOCK_SKEW_MINUTES = 10;

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseBoolean(value) {
  return String(value || "").toLowerCase() === "true";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex")
  );
}

function extractBearerToken(authorization) {
  const value = normalizeOptionalString(authorization);
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function buildGymVisitConfig(env = process.env) {
  return {
    enabled: parseBoolean(env.GYM_VISITS_ENABLED),
    profileKey: normalizeOptionalString(env.GYM_VISIT_PROFILE_KEY),
    profileName: normalizeOptionalString(env.GYM_VISIT_PROFILE_NAME) || "Gym Visit Profile",
    shortcutTokenHash: normalizeOptionalString(env.GYM_VISIT_SHORTCUT_TOKEN_HASH),
    allowedRadiusMeters:
      normalizeNumber(env.GYM_VISIT_ALLOWED_RADIUS_METERS) ||
      DEFAULT_ALLOWED_RADIUS_METERS,
    minRepeatHours:
      normalizeNumber(env.GYM_VISIT_MIN_REPEAT_HOURS) ||
      DEFAULT_MIN_REPEAT_HOURS,
    maxClockSkewMinutes:
      normalizeNumber(env.GYM_VISIT_MAX_CLOCK_SKEW_MINUTES) ||
      DEFAULT_MAX_CLOCK_SKEW_MINUTES,
    optumActionMode: normalizeOptionalString(env.OPTUM_AUTOCHECKIN_MODE) || "assist-only",
    gym: {
      slug: normalizeOptionalString(env.GYM_VISIT_GYM_SLUG) || "anytime-fitness",
      name: normalizeOptionalString(env.GYM_VISIT_GYM_NAME) || "Anytime Fitness",
      latitude: normalizeNumber(env.GYM_VISIT_GYM_LATITUDE),
      longitude: normalizeNumber(env.GYM_VISIT_GYM_LONGITUDE)
    }
  };
}

export function hashGymVisitToken(token) {
  return sha256(token);
}

export function verifyGymVisitToken({ authorization, config }) {
  const token = extractBearerToken(authorization);
  if (!token || !config.shortcutTokenHash) {
    return false;
  }

  return safeEqualHex(sha256(token), config.shortcutTokenHash);
}

export function distanceMeters(pointA, pointB) {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(pointA.latitude);
  const lat2 = toRadians(pointB.latitude);
  const deltaLat = toRadians(pointB.latitude - pointA.latitude);
  const deltaLon = toRadians(pointB.longitude - pointA.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateGymVisitRequest({ body, config, now = new Date() }) {
  if (!config.enabled) {
    return { valid: false, status: 503, error: "Gym visits are disabled" };
  }

  if (!config.profileKey || !config.shortcutTokenHash) {
    return { valid: false, status: 503, error: "Gym visit profile is not configured" };
  }

  if (body?.profileKey !== config.profileKey) {
    return { valid: false, status: 404, error: "Not found" };
  }

  if (config.gym.latitude === null || config.gym.longitude === null) {
    return { valid: false, status: 503, error: "Gym location is not configured" };
  }

  const occurredAt = body?.occurredAt ? new Date(body.occurredAt) : now;
  if (Number.isNaN(occurredAt.getTime())) {
    return { valid: false, status: 400, error: "occurredAt must be a valid date" };
  }

  const clockSkewMs = Math.abs(now.getTime() - occurredAt.getTime());
  if (clockSkewMs > config.maxClockSkewMinutes * 60 * 1000) {
    return {
      valid: false,
      status: 400,
      error: `occurredAt must be within ${config.maxClockSkewMinutes} minutes`
    };
  }

  const location = body?.location || {};
  const latitude = normalizeNumber(location.latitude);
  const longitude = normalizeNumber(location.longitude);
  if (latitude === null || longitude === null) {
    return {
      valid: false,
      status: 400,
      error: "location.latitude and location.longitude are required"
    };
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { valid: false, status: 400, error: "location is out of range" };
  }

  const point = { latitude, longitude };
  const gymPoint = {
    latitude: config.gym.latitude,
    longitude: config.gym.longitude
  };
  const distance = distanceMeters(point, gymPoint);
  const accuracyMeters = normalizeNumber(location.accuracyMeters);
  const deviceLabel = normalizeOptionalString(body.deviceLabel) || "iPhone";
  const shortcutRunId = normalizeOptionalString(body.shortcutRunId);
  const outsideRadius = distance > config.allowedRadiusMeters;

  return {
    valid: true,
    value: {
      profileKey: body.profileKey,
      gym: config.gym,
      occurredAt,
      latitude,
      longitude,
      accuracyMeters,
      distanceMeters: Math.round(distance),
      deviceLabel,
      shortcutRunId,
      accepted: !outsideRadius,
      rejectionReason: outsideRadius ? "outside_geofence" : null
    }
  };
}

export function buildOptumInstruction({ accepted, duplicate, config }) {
  if (!accepted || duplicate) {
    return {
      action: "none",
      state: duplicate ? "duplicate_suppressed" : "not_requested"
    };
  }

  return {
    action: "open_optum_on_phone",
    state:
      config.optumActionMode === "official-only"
        ? "pending_official_action"
        : "pending_phone_confirmation"
  };
}

export async function registerGymVisit({
  body,
  authorization,
  config = buildGymVisitConfig(),
  now = new Date(),
  withTransaction
}) {
  if (!verifyGymVisitToken({ authorization, config })) {
    return { status: 401, payload: { error: "Unauthorized" } };
  }

  const validation = validateGymVisitRequest({ body, config, now });
  if (!validation.valid) {
    return { status: validation.status, payload: { error: validation.error } };
  }

  const value = validation.value;
  const result = await withTransaction(async (client) => {
    const profileResult = await client.query(
      `
      INSERT INTO gym_visit_profiles (profile_key, display_name)
      VALUES ($1, $2)
      ON CONFLICT (profile_key) DO UPDATE
      SET display_name = EXCLUDED.display_name
      RETURNING id, profile_key
      `,
      [value.profileKey, config.profileName]
    );
    const profile = profileResult.rows[0];

    const gymResult = await client.query(
      `
      INSERT INTO gym_locations (
        profile_id,
        slug,
        name,
        latitude,
        longitude,
        radius_meters
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (profile_id, slug) DO UPDATE
      SET name = EXCLUDED.name,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          radius_meters = EXCLUDED.radius_meters,
          is_active = TRUE
      RETURNING id, slug, name
      `,
      [
        profile.id,
        value.gym.slug,
        value.gym.name,
        value.gym.latitude,
        value.gym.longitude,
        config.allowedRadiusMeters
      ]
    );
    const gym = gymResult.rows[0];

    const repeatWindowHours = config.minRepeatHours;
    const duplicateResult = value.accepted
      ? await client.query(
          `
          SELECT id, occurred_at
          FROM gym_visits
          WHERE profile_id = $1
            AND gym_location_id = $2
            AND occurred_at >= $3::timestamptz - ($4::int * interval '1 hour')
            AND occurred_at <= $3::timestamptz + ($4::int * interval '1 hour')
          ORDER BY occurred_at DESC
          LIMIT 1
          `,
          [profile.id, gym.id, value.occurredAt.toISOString(), repeatWindowHours]
        )
      : { rowCount: 0, rows: [] };
    const duplicate = duplicateResult.rowCount > 0;
    const accepted = value.accepted && !duplicate;
    const rejectionReason = duplicate ? "duplicate_visit_window" : value.rejectionReason;
    const optum = buildOptumInstruction({ accepted, duplicate, config });

    const attemptResult = await client.query(
      `
      INSERT INTO gym_visit_attempts (
        profile_id,
        gym_location_id,
        device_label,
        shortcut_run_id,
        occurred_at,
        latitude,
        longitude,
        accuracy_meters,
        distance_meters,
        accepted,
        rejection_reason,
        optum_action_state,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      RETURNING id
      `,
      [
        profile.id,
        gym.id,
        value.deviceLabel,
        value.shortcutRunId,
        value.occurredAt.toISOString(),
        value.latitude,
        value.longitude,
        value.accuracyMeters,
        value.distanceMeters,
        accepted,
        rejectionReason,
        optum.state,
        JSON.stringify({
          source: "ios_shortcut",
          duplicateVisitId: duplicate ? duplicateResult.rows[0].id : null
        })
      ]
    );

    let visit = null;
    if (accepted) {
      const visitResult = await client.query(
        `
        INSERT INTO gym_visits (
          profile_id,
          gym_location_id,
          visit_attempt_id,
          occurred_at,
          device_label,
          shortcut_run_id,
          optum_action_state
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, occurred_at, optum_action_state
        `,
        [
          profile.id,
          gym.id,
          attemptResult.rows[0].id,
          value.occurredAt.toISOString(),
          value.deviceLabel,
          value.shortcutRunId,
          optum.state
        ]
      );
      visit = visitResult.rows[0];
    }

    return {
      attemptId: attemptResult.rows[0].id,
      visit,
      gym,
      accepted,
      duplicate,
      rejectionReason,
      distanceMeters: value.distanceMeters,
      optum
    };
  });

  return {
    status: 200,
    payload: {
      accepted: result.accepted,
      duplicate: result.duplicate,
      rejectionReason: result.rejectionReason,
      attemptId: result.attemptId,
      visitId: result.visit?.id || null,
      gym: result.gym,
      distanceMeters: result.distanceMeters,
      optum: result.optum
    }
  };
}

export async function recordOptumResult({
  body,
  authorization,
  config = buildGymVisitConfig(),
  withTransaction
}) {
  if (!verifyGymVisitToken({ authorization, config })) {
    return { status: 401, payload: { error: "Unauthorized" } };
  }

  const visitId = normalizeOptionalString(body?.visitId);
  const result = normalizeOptionalString(body?.result);
  const allowedResults = ["succeeded", "manual_required", "failed"];
  if (!visitId || !allowedResults.includes(result)) {
    return {
      status: 400,
      payload: { error: "visitId and a valid result are required" }
    };
  }

  const note = normalizeOptionalString(body.note);
  const updated = await withTransaction(async (client) => {
    const visitResult = await client.query(
      `
      UPDATE gym_visits
      SET optum_result = $2,
          optum_result_at = NOW(),
          optum_action_state = $3
      WHERE id = $1
      RETURNING id, optum_result, optum_action_state
      `,
      [
        visitId,
        result,
        result === "succeeded"
          ? "completed"
          : result === "manual_required"
            ? "manual_required"
            : "failed"
      ]
    );

    if (!visitResult.rowCount) {
      return null;
    }

    await client.query(
      `
      UPDATE gym_visit_attempts
      SET optum_action_state = $2,
          metadata = metadata || $3::jsonb
      WHERE id = (
        SELECT visit_attempt_id FROM gym_visits WHERE id = $1
      )
      `,
      [
        visitId,
        visitResult.rows[0].optum_action_state,
        JSON.stringify({ optumResult: result, optumNote: note })
      ]
    );

    return visitResult.rows[0];
  });

  if (!updated) {
    return { status: 404, payload: { error: "Not found" } };
  }

  return { status: 200, payload: { visit: updated } };
}

export async function listRecentGymVisits({
  authorization,
  config = buildGymVisitConfig(),
  limit = 10,
  pool
}) {
  if (!verifyGymVisitToken({ authorization, config })) {
    return { status: 401, payload: { error: "Unauthorized" } };
  }

  if (!config.enabled) {
    return { status: 503, payload: { error: "Gym visits are disabled" } };
  }

  const boundedLimit = Number.isFinite(Number(limit))
    ? Math.min(Math.max(Number(limit), 1), 25)
    : 10;
  const result = await pool.query(
    `
    SELECT
      gv.id,
      gv.occurred_at AS "occurredAt",
      gv.device_label AS "deviceLabel",
      gv.shortcut_run_id AS "shortcutRunId",
      gv.optum_action_state AS "optumActionState",
      gv.optum_result AS "optumResult",
      gv.optum_result_at AS "optumResultAt",
      gl.slug AS "gymSlug",
      gl.name AS "gymName",
      gva.distance_meters AS "distanceMeters"
    FROM gym_visits gv
    JOIN gym_visit_profiles gvp ON gvp.id = gv.profile_id
    JOIN gym_locations gl ON gl.id = gv.gym_location_id
    JOIN gym_visit_attempts gva ON gva.id = gv.visit_attempt_id
    WHERE gvp.profile_key = $1
    ORDER BY gv.occurred_at DESC
    LIMIT $2
    `,
    [config.profileKey, boundedLimit]
  );

  return { status: 200, payload: { items: result.rows } };
}
