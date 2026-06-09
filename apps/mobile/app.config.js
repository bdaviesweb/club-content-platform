const appName = process.env.EXPO_PUBLIC_APP_NAME || "Club Content";
const slug = process.env.EXPO_PUBLIC_APP_SLUG || "club-content";
const version = process.env.EXPO_PUBLIC_APP_VERSION || "0.1.0";
const bundleIdentifier =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
  "com.hermes.clubcontent";
const easProjectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  "83871f8c-a185-47d5-8f19-5e2749dc81d2";
const expoOwner = process.env.EXPO_PUBLIC_EXPO_OWNER || "clubcontent";
const isLocalBuild =
  process.env.EXPO_LOCAL_BUILD === "1" || process.env.EXPO_LOCAL_BUILD === "true";
const noUpdates = process.env.EXPO_NO_UPDATES === "1" || process.env.EXPO_NO_UPDATES === "true";

module.exports = {
  expo: {
    name: appName,
    slug,
    owner: expoOwner,
    version,
    scheme: "clubcontent",
    orientation: "portrait",
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          "This app needs camera access so you can capture new posts.",
        NSPhotoLibraryUsageDescription:
          "This app needs photo library access so you can choose media for a post.",
        NSPhotoLibraryAddUsageDescription:
          "This app needs photo library access so you can save or replace media while editing a post.",
        NSLocationWhenInUseUsageDescription:
          "This app uses location to help with post context when needed.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "This app uses location to help with post context when needed.",
        NSUserNotificationUsageDescription:
          "This app uses notifications to show review and post updates."
      }
    },
    android: {
      package:
        process.env.EXPO_PUBLIC_ANDROID_PACKAGE ||
        "com.hermes.clubcontent"
    },
    extra: {
      eas: { projectId: easProjectId }
    },
    updates: {
      enabled: !(isLocalBuild || noUpdates)
    }
  }
};
