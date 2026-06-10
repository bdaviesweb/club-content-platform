const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildInstallationId,
  buildPushRegistrationPayload,
  registerPushToken,
  requestExpoPushToken
} = require("./pushRegistration");

test("buildInstallationId creates a stable user and app scoped id", () => {
  assert.equal(
    buildInstallationId({
      projectId: "project-123",
      userEmail: " Parent@Example.COM ",
      platform: "ios",
      appId: "Club Content"
    }),
    "project-123:parent-example.com:ios:club-content"
  );
});

test("buildPushRegistrationPayload matches the API contract", () => {
  const payload = buildPushRegistrationPayload({
    userEmail: " parent@example.com ",
    pushToken: "ExponentPushToken[test]",
    projectId: "project-123",
    platform: "ios",
    appId: "club-content",
    environment: "production",
    deviceLabel: "ios"
  });

  assert.deepEqual(payload, {
    userEmail: "parent@example.com",
    installationId: "project-123:parent-example.com:ios:club-content",
    pushToken: "ExponentPushToken[test]",
    provider: "expo",
    platform: "ios",
    appId: "club-content",
    environment: "production",
    deviceLabel: "ios",
    enabled: true
  });
});

test("requestExpoPushToken requests permission and returns an Expo token", async () => {
  const result = await requestExpoPushToken({
    constants: {
      expoConfig: {
        extra: {
          eas: {
            projectId: "project-123"
          }
        }
      }
    },
    notifications: {
      async getPermissionsAsync() {
        return { status: "undetermined" };
      },
      async requestPermissionsAsync() {
        return { status: "granted" };
      },
      async getExpoPushTokenAsync(options) {
        assert.deepEqual(options, { projectId: "project-123" });
        return { data: "ExponentPushToken[test]" };
      }
    }
  });

  assert.deepEqual(result, {
    ok: true,
    projectId: "project-123",
    pushToken: "ExponentPushToken[test]"
  });
});

test("registerPushToken posts the registration payload", async () => {
  const requests = [];
  const result = await registerPushToken({
    apiBaseUrl: "https://clubcontent-api.davmn.net/",
    userEmail: "parent@example.com",
    platform: "ios",
    appId: "club-content",
    environment: "test",
    deviceLabel: "ios",
    constants: {
      expoConfig: {
        extra: {
          eas: {
            projectId: "project-123"
          }
        }
      }
    },
    notifications: {
      async getPermissionsAsync() {
        return { status: "granted" };
      },
      async requestPermissionsAsync() {
        throw new Error("permission should not be requested");
      },
      async getExpoPushTokenAsync() {
        return { data: "ExponentPushToken[test]" };
      }
    },
    async fetchImpl(url, init) {
      requests.push({ url, init });
      return {
        ok: true,
        async json() {
          return {
            registration: {
              tokenPreview: "Expone...n[test]"
            }
          };
        }
      };
    }
  });

  assert.equal(result.registered, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://clubcontent-api.davmn.net/push-tokens");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    userEmail: "parent@example.com",
    installationId: "project-123:parent-example.com:ios:club-content",
    pushToken: "ExponentPushToken[test]",
    provider: "expo",
    platform: "ios",
    appId: "club-content",
    environment: "test",
    deviceLabel: "ios",
    enabled: true
  });
});
