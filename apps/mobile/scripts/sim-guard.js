#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

const DEFAULT_BUNDLE_ID = "com.hermes.clubcontent";
const KNOWN_CUSTOM_BUNDLE_IDS = [
  "com.clubhqpro.aicoach",
  "com.clubhqpro.SportsWeatherTracker",
  "com.davmn.clubsandfieldslive"
];

function runSimctl(args) {
  return execFileSync("xcrun", ["simctl", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function parseInstalledApps(listAppsOutput) {
  const apps = [];
  const lines = String(listAppsOutput || "").split("\n");
  for (const line of lines) {
    const match = line.match(/"([^"]+)"\s*=\s*\{/);
    if (match) apps.push(match[1]);
  }
  return apps;
}

function getExpectedBundleId() {
  return (
    process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
    process.env.CLUB_MOBILE_BUNDLE_ID ||
    DEFAULT_BUNDLE_ID
  );
}

function getCurrentApps() {
  try {
    return parseInstalledApps(runSimctl(["listapps", "booted"]));
  } catch (error) {
    const reason = error?.stderr ? String(error.stderr).trim() : String(error.message || error);
    throw new Error(`Unable to inspect the booted simulator: ${reason}`);
  }
}

function check() {
  const expectedBundleId = getExpectedBundleId();
  const apps = getCurrentApps();

  if (!apps.includes(expectedBundleId)) {
    const installed = apps.filter(Boolean).sort();
    throw new Error(
      [
        `Expected ${expectedBundleId} to be installed on the booted simulator.`,
        `Installed bundle ids: ${installed.length ? installed.join(", ") : "(none found)"}`,
        "Run the Club Content install flow for com.hermes.clubcontent, not the AI Coach app."
      ].join("\n")
    );
  }

  const foreignInstalled = KNOWN_CUSTOM_BUNDLE_IDS.filter((bundleId) => apps.includes(bundleId));
  const note = foreignInstalled.length
    ? `Other app(s) also installed and kept separate: ${foreignInstalled.join(", ")}`
    : "No known foreign app bundles are installed.";

  process.stdout.write(
    [
      `Simulator check passed for ${expectedBundleId}.`,
      note
    ].join("\n") + "\n"
  );
}

function list() {
  const apps = getCurrentApps().sort();
  const managed = apps.filter((bundleId) => bundleId === DEFAULT_BUNDLE_ID || KNOWN_CUSTOM_BUNDLE_IDS.includes(bundleId));
  process.stdout.write(
    JSON.stringify(
      {
        expectedBundleId: getExpectedBundleId(),
        managedApps: managed,
        allInstalledBundleIds: apps
      },
      null,
      2
    ) + "\n"
  );
}

const command = process.argv[2] || "check";

try {
  if (command === "list") {
    list();
  } else if (command === "check") {
    check();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
