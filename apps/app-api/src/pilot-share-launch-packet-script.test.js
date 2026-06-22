import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_share_launch_packet.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-share-launch-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeBundle(name, handoffContents, summaryContents = "pilot_rehearsal_decision=GO\n") {
  const bundleDir = path.join(tempRoot, "pilot-rehearsal", name);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "handoff.md"), handoffContents);
  fs.writeFileSync(path.join(bundleDir, "summary.txt"), summaryContents);
  fs.writeFileSync(path.join(bundleDir, "status.txt"), "inspect=ok\n");
  return bundleDir;
}

test("pilot share packet generates and copies a reusable launch packet", () => {
  const bundleDir = writeBundle(
    "20260622T040000Z-simulated-north-river",
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
  const sharePath = path.join(tempRoot, "exports", "pilot-launch-packet-share.md");

  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REHEARSAL_BUNDLE_DIR: bundleDir,
      PILOT_LAUNCH_PACKET_PATH: packetPath,
      PILOT_LAUNCH_PACKET_SHARE_PATH: sharePath
    }
  });

  assert.match(output, /pilot_launch_packet_path=.*pilot-launch-packet\.md/);
  assert.match(output, /pilot_launch_packet_share_path=.*pilot-launch-packet-share\.md/);
  assert.match(output, /pilot_launch_packet_source_bundle=.*20260622T040000Z-simulated-north-river/);
  assert.equal(fs.existsSync(packetPath), true);
  assert.equal(fs.existsSync(sharePath), true);

  const packet = fs.readFileSync(packetPath, "utf8");
  const share = fs.readFileSync(sharePath, "utf8");
  assert.equal(share, packet);
  assert.match(share, /# Pilot Launch Packet/);
  assert.match(share, /Evidence path: `.*20260622T040000Z-simulated-north-river`/);
  assert.match(share, /Decision: `GO`/);
  assert.match(share, /Blockers: none\./);
});

test("pilot share packet defaults to the latest rehearsal bundle", () => {
  writeBundle("20260622T010000Z-simulated-north-river", "# Pilot Rehearsal Handoff\n");
  const latestBundleDir = writeBundle(
    "20260622T050000Z-simulated-north-river",
    "# Pilot Rehearsal Handoff\n"
  );
  const sharePath = path.join(tempRoot, "pilot-launch-packet-share-latest.md");

  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_REHEARSAL_OUTPUT_DIR: path.join(tempRoot, "pilot-rehearsal"),
      PILOT_LAUNCH_PACKET_SHARE_PATH: sharePath
    }
  });

  assert.match(output, /pilot_launch_packet_source_bundle=.*20260622T050000Z-simulated-north-river/);
  assert.equal(fs.existsSync(sharePath), true);
  const share = fs.readFileSync(sharePath, "utf8");
  assert.match(share, /Source bundle: `.*20260622T050000Z-simulated-north-river`/);
  assert.match(share, /Blockers: none\./);
});
