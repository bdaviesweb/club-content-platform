function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function maskPushToken(pushToken) {
  if (!pushToken) {
    return null;
  }

  if (pushToken.length <= 12) {
    return pushToken;
  }

  return `${pushToken.slice(0, 6)}...${pushToken.slice(-6)}`;
}

export async function registerPushToken({
  body,
  withTransaction,
  defaultProvider = "expo"
}) {
  const userEmail = normalizeOptionalString(body.userEmail);
  const installationId = normalizeOptionalString(body.installationId);
  const pushToken = normalizeOptionalString(body.pushToken);
  const platform = normalizeOptionalString(body.platform);
  const provider = normalizeOptionalString(body.provider) || defaultProvider;
  const appId = normalizeOptionalString(body.appId);
  const environment = normalizeOptionalString(body.environment);
  const deviceLabel = normalizeOptionalString(body.deviceLabel);
  const enabled = body.enabled !== false;

  if (!userEmail || !installationId) {
    return {
      status: 400,
      payload: {
        error: "userEmail and installationId are required"
      }
    };
  }

  if (enabled && !pushToken) {
    return {
      status: 400,
      payload: {
        error: "pushToken is required when enabled is true"
      }
    };
  }

  const result = await withTransaction(async (client) => {
    const userResult = await client.query(
      `SELECT id, email FROM users WHERE email = $1`,
      [userEmail]
    );

    if (!userResult.rowCount) {
      return null;
    }

    const userId = userResult.rows[0].id;
    const action = enabled ? "push_token.upserted" : "push_token.revoked";
    const metadata = {
      push: {
        provider,
        installationId,
        pushToken: enabled ? pushToken : null,
        platform,
        appId,
        environment,
        deviceLabel,
        enabled
      }
    };

    await client.query(
      `
      INSERT INTO audit_logs (entity_type, entity_id, action, metadata)
      VALUES ('user', $1, $2, $3::jsonb)
      `,
      [userId, action, JSON.stringify(metadata)]
    );

    return {
      userId,
      userEmail: userResult.rows[0].email,
      provider,
      installationId,
      platform,
      appId,
      environment,
      deviceLabel,
      enabled,
      pushToken: enabled ? pushToken : null,
      tokenPreview: enabled ? maskPushToken(pushToken) : null
    };
  });

  if (!result) {
    return {
      status: 404,
      payload: { error: "Not found" }
    };
  }

  return {
    status: 200,
    payload: { registration: result }
  };
}
