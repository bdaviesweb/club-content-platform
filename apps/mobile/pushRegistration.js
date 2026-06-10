const defaultInstallationIdPrefix = "club-content";

function loadDefaultDependencies() {
  const constantsModule = require("expo-constants");
  const constants = constantsModule.default || constantsModule;
  const notifications = require("expo-notifications");
  const { Platform } = require("react-native");

  return {
    constants,
    notifications,
    platform: Platform.OS,
    deviceLabel: Platform.OS,
    appId: constants?.expoConfig?.slug || "club-content"
  };
}

function getExpoProjectId(constants) {
  return (
    constants?.expoConfig?.extra?.eas?.projectId ||
    constants?.easConfig?.projectId ||
    constants?.manifest2?.extra?.expoClient?.extra?.eas?.projectId ||
    null
  );
}

function buildInstallationId({
  projectId,
  userEmail,
  platform,
  appId
}) {
  const normalizedProjectId = String(projectId || defaultInstallationIdPrefix).trim();
  const normalizedUserEmail = String(userEmail || "anonymous").trim().toLowerCase();
  const normalizedPlatform = String(platform || "unknown").trim().toLowerCase();
  const normalizedAppId = String(appId || "mobile").trim().toLowerCase();

  return [normalizedProjectId, normalizedUserEmail, normalizedPlatform, normalizedAppId]
    .map((part) => part.replace(/[^a-z0-9._-]+/gi, "-"))
    .join(":");
}

function buildPushRegistrationPayload({
  userEmail,
  pushToken,
  projectId,
  platform,
  appId,
  environment,
  deviceLabel,
  enabled = true
}) {
  return {
    userEmail: String(userEmail || "").trim(),
    installationId: buildInstallationId({
      projectId,
      userEmail,
      platform,
      appId
    }),
    pushToken: enabled ? pushToken : null,
    provider: "expo",
    platform,
    appId,
    environment,
    deviceLabel,
    enabled
  };
}

async function requestExpoPushToken(options = {}) {
  const defaults =
    options.notifications && options.constants ? {} : loadDefaultDependencies();
  const notifications = options.notifications || defaults.notifications;
  const constants = options.constants || defaults.constants;
  const projectId = getExpoProjectId(constants);
  if (!projectId) {
    return {
      ok: false,
      reason: "missing_project_id"
    };
  }

  const currentPermission = await notifications.getPermissionsAsync();
  let status = currentPermission?.status;

  if (status !== "granted") {
    const requestedPermission = await notifications.requestPermissionsAsync();
    status = requestedPermission?.status;
  }

  if (status !== "granted") {
    return {
      ok: false,
      reason: "permission_denied"
    };
  }

  const tokenResult = await notifications.getExpoPushTokenAsync({ projectId });
  const pushToken = tokenResult?.data;

  if (!pushToken) {
    return {
      ok: false,
      reason: "missing_push_token"
    };
  }

  return {
    ok: true,
    projectId,
    pushToken
  };
}

async function registerPushToken({
  apiBaseUrl,
  userEmail,
  fetchImpl = fetch,
  notifications,
  constants,
  platform,
  appId,
  environment,
  deviceLabel
}) {
  const defaults =
    notifications && constants && platform && appId && deviceLabel
      ? {}
      : loadDefaultDependencies();
  const baseUrl = String(apiBaseUrl || "").replace(/\/+$/, "");
  const normalizedEmail = String(userEmail || "").trim();
  const resolvedConstants = constants || defaults.constants;
  const resolvedPlatform = platform || defaults.platform;
  const resolvedAppId = appId || defaults.appId;
  const resolvedEnvironment =
    environment || (typeof __DEV__ !== "undefined" && __DEV__ ? "development" : "production");
  const resolvedDeviceLabel = deviceLabel || defaults.deviceLabel;

  if (!baseUrl || !normalizedEmail) {
    return {
      registered: false,
      reason: "missing_required_fields"
    };
  }

  const tokenResult = await requestExpoPushToken({
    notifications: notifications || defaults.notifications,
    constants: resolvedConstants
  });
  if (!tokenResult.ok) {
    return {
      registered: false,
      reason: tokenResult.reason
    };
  }

  const payload = buildPushRegistrationPayload({
    userEmail: normalizedEmail,
    pushToken: tokenResult.pushToken,
    projectId: tokenResult.projectId,
    platform: resolvedPlatform,
    appId: resolvedAppId,
    environment: resolvedEnvironment,
    deviceLabel: resolvedDeviceLabel,
    enabled: true
  });

  const response = await fetchImpl(`${baseUrl}/push-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return {
      registered: false,
      reason: "registration_failed",
      status: response.status
    };
  }

  const result = await response.json();
  return {
    registered: true,
    registration: result.registration
  };
}

module.exports = {
  buildInstallationId,
  buildPushRegistrationPayload,
  getExpoProjectId,
  registerPushToken,
  requestExpoPushToken
};
