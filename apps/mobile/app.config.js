const appName = process.env.EXPO_PUBLIC_APP_NAME || "Club Content";
const slug = process.env.EXPO_PUBLIC_APP_SLUG || "club-content";
const version = process.env.EXPO_PUBLIC_APP_VERSION || "0.1.0";
const bundleIdentifier =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
  "com.hermes.clubcontent";
const easProjectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  "65730568-7767-47c8-8d3a-9545a5973af5";
const expoOwner = process.env.EXPO_PUBLIC_EXPO_OWNER || "bdaviesweb";

module.exports = {
  expo: {
    name: appName,
    slug,
    owner: expoOwner,
    version,
    orientation: "portrait",
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      package:
        process.env.EXPO_PUBLIC_ANDROID_PACKAGE ||
        "com.hermes.clubcontent"
    },
    extra: {
      eas: easProjectId ? { projectId: easProjectId } : undefined
    }
  }
};
