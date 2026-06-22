import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_launch_packet.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-launch-packet-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeBundle(name, contents) {
  const bundleDir = path.join(tempRoot, "pilot-rehearsal", name);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "handoff.md"), contents);
  fs.writeFileSync(path.join(bundleDir, "summary.txt"), "pilot_rehearsal_decision=GO\n");
  fs.writeFileSync(path.join(bundleDir, "status.txt"), "inspect=ok\n");
  return bundleDir;
}

test("pilot launch packet converts a rehearsal bundle into a portable markdown packet", () => {
  const bundleDir = writeBundle(
    "20260622T020000Z-simulated-north-river",
    [
      "# Pilot Rehearsal Handoff",
      "",
      "- Profile: `simulated-north-river`",
      "- Bundle: `/tmp/example-bundle`",
      "- Handoff file: `/tmp/example-bundle/handoff.md`",
      "- Decision: `GO`",
      "- Demo command center: `http://127.0.0.1:3013/demo`",
      "- Quick review: `http://127.0.0.1:3013/quick-review`",
      "- Workflow settings: `http://127.0.0.1:3013/workflow-settings?clubSlug=north-river-soccer-club`",
      "- Admin API readiness: `https://clubcontent-api.davmn.net/app/readiness`",
      "- Internal feed API: `https://clubcontent-api.davmn.net/feed/internal?includeSmoke=1`",
      "- Rehearsal command: `npm run pilot:rehearse`",
      "- Summary file: `/tmp/example-bundle/summary.txt`"
    ].join("\n")
  );
  const packetPath = path.join(tempRoot, "pilot-launch-packet.md");

  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REHEARSAL_BUNDLE_DIR: bundleDir,
      PILOT_LAUNCH_PACKET_PATH: packetPath
    }
  });

  assert.match(output, /pilot_launch_packet_path=.*pilot-launch-packet\.md/);
  assert.match(output, /pilot_launch_packet_source_bundle=.*20260622T020000Z-simulated-north-river/);
  assert.equal(fs.existsSync(packetPath), true);

  const packet = fs.readFileSync(packetPath, "utf8");
  assert.match(packet, /# Pilot Launch Packet/);
  assert.match(packet, /Evidence path: `.*20260622T020000Z-simulated-north-river`/);
  assert.match(packet, /Source bundle: `.*20260622T020000Z-simulated-north-river`/);
  assert.match(packet, /## Portable Handoff/);
  assert.match(packet, /Decision: `GO`/);
  assert.match(packet, /Demo command center: `http:\/\/127\.0\.0\.1:3013\/demo`/);
  assert.match(packet, /Quick review: `http:\/\/127\.0\.0\.1:3013\/quick-review`/);
  assert.match(packet, /Workflow settings: `http:\/\/127\.0\.0\.1:3013\/workflow-settings\?clubSlug=north-river-soccer-club`/);
  assert.match(packet, /Internal feed API: `https:\/\/clubcontent-api\.davmn\.net\/feed\/internal\?includeSmoke=1`/);
  assert.match(packet, /Blockers: none\./);
  assert.match(packet, /## Copy Notes/);
});

test("pilot launch packet surfaces blockers when the rehearsal bundle has them", () => {
  const bundleDir = path.join(tempRoot, "pilot-rehearsal", "20260622T040000Z-simulated-north-river");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "handoff.md"),
    [
      "# Pilot Rehearsal Handoff",
      "",
      "- Profile: `simulated-north-river`",
      "- Bundle: `/tmp/example-bundle`",
      "- Handoff file: `/tmp/example-bundle/handoff.md`",
      "- Decision: `NO_GO`",
      "",
      "## Blockers",
      "",
      "- Queue is not clean"
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(bundleDir, "summary.txt"),
    [
      "pilot_rehearsal_decision=NO_GO",
      "blocker=Queue is not clean"
    ].join("\n")
  );
  fs.writeFileSync(path.join(bundleDir, "status.txt"), "audit=failed exit_code=1\n");
  const packetPath = path.join(tempRoot, "pilot-launch-packet-blocked.md");

  execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REHEARSAL_BUNDLE_DIR: bundleDir,
      PILOT_LAUNCH_PACKET_PATH: packetPath
    }
  });

  const packet = fs.readFileSync(packetPath, "utf8");
  assert.match(packet, /Blockers: see the Portable Handoff section above\./);
  assert.match(packet, /## Blockers/);
  assert.match(packet, /Queue is not clean/);
  assert.match(packet, /Decision: `NO_GO`/);
});

test("pilot launch packet defaults to the latest rehearsal bundle", () => {
  writeBundle("20260622T010000Z-simulated-north-river", "# Pilot Rehearsal Handoff\n");
  const latestBundleDir = writeBundle("20260622T030000Z-simulated-north-river", "# Pilot Rehearsal Handoff\n");
  const packetPath = path.join(tempRoot, "pilot-launch-packet-latest.md");

  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REHEARSAL_OUTPUT_DIR: path.join(tempRoot, "pilot-rehearsal"),
      PILOT_LAUNCH_PACKET_PATH: packetPath
    }
  });

  assert.match(output, /pilot_launch_packet_source_bundle=.*20260622T040000Z-simulated-north-river/);
  const packet = fs.readFileSync(packetPath, "utf8");
  assert.match(packet, /Source bundle: `.*20260622T040000Z-simulated-north-river`/);
});
