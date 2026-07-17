import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_deliver_launch_packet.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-deliver-launch-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeBundle(name, handoffContents = "# Pilot Rehearsal Handoff\n") {
  const bundleDir = path.join(tempRoot, "pilot-rehearsal", name);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "handoff.md"),
    [
      handoffContents.trimEnd(),
      "- Evidence path: `/tmp/example-bundle`",
      "- Decision: `GO`",
      "- Demo command center: `http://127.0.0.1:3013/demo`"
    ].join("\n")
  );
  fs.writeFileSync(path.join(bundleDir, "summary.txt"), "pilot_rehearsal_decision=GO\n");
  fs.writeFileSync(path.join(bundleDir, "status.txt"), "inspect=ok\n");
  return bundleDir;
}

function setupToolchain(includeOpen) {
  const binDir = path.join(tempRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const links = {
    bash: "/bin/bash",
    cat: "/bin/cat",
    cp: "/bin/cp",
    dirname: "/usr/bin/dirname",
    find: "/usr/bin/find",
    grep: "/usr/bin/grep",
    mkdir: "/bin/mkdir",
    paste: "/usr/bin/paste",
    sed: "/usr/bin/sed",
    sort: "/usr/bin/sort",
    tail: "/usr/bin/tail",
    awk: "/usr/bin/awk",
    env: "/usr/bin/env"
  };

  for (const [name, target] of Object.entries(links)) {
    const linkPath = path.join(binDir, name);
    if (!fs.existsSync(linkPath)) {
      fs.symlinkSync(target, linkPath);
    }
  }

  const openLog = path.join(tempRoot, "open.log");
  if (includeOpen) {
    const stubPath = path.join(binDir, "open");
    fs.writeFileSync(
      stubPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `printf '%s\\n' \"$*\" >> \"${openLog}\"`
      ].join("\n")
    );
    fs.chmodSync(stubPath, 0o755);
    return { binDir, openLog };
  }

  const stubPath = path.join(binDir, "open");
  if (fs.existsSync(stubPath)) {
    fs.unlinkSync(stubPath);
  }

  return { binDir };
}

test("pilot deliver packet opens the ready-to-forward message body", () => {
  const { binDir, openLog } = setupToolchain(true);
  const bundleDir = writeBundle("20260622T060000Z-simulated-north-river");
  const packetPath = path.join(tempRoot, "pilot-launch-packet.md");
  const sharePath = path.join(tempRoot, "exports", "pilot-launch-packet-share.md");
  const messagePath = path.join(tempRoot, "messages", "pilot-launch-packet-share-message.txt");

  const output = execFileSync("/bin/bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: binDir,
      PILOT_REHEARSAL_BUNDLE_DIR: bundleDir,
      PILOT_LAUNCH_PACKET_PATH: packetPath,
      PILOT_LAUNCH_PACKET_SHARE_PATH: sharePath,
      PILOT_LAUNCH_PACKET_MESSAGE_PATH: messagePath
    }
  });

  assert.match(output, /pilot_launch_packet_delivery_target=open/);
  assert.match(output, /pilot_launch_packet_delivery_message_path=.*pilot-launch-packet-share-message\.txt/);
  assert.match(output, /pilot_launch_packet_delivery_share_path=.*pilot-launch-packet-share\.md/);
  assert.equal(fs.existsSync(sharePath), true);
  assert.equal(fs.existsSync(messagePath), true);
  assert.equal(fs.readFileSync(openLog, "utf8").trim(), `${messagePath} ${sharePath}`);
  assert.match(fs.readFileSync(messagePath, "utf8"), /Pilot launch packet ready\./);
  assert.match(fs.readFileSync(messagePath, "utf8"), /Packet file: .*pilot-launch-packet-share\.md/);
  assert.match(fs.readFileSync(messagePath, "utf8"), /Decision: GO/);
});

test("pilot deliver packet falls back to a message file when open is unavailable", () => {
  const { binDir } = setupToolchain(false);
  const bundleDir = writeBundle("20260622T070000Z-simulated-north-river");
  const packetPath = path.join(tempRoot, "pilot-launch-packet-fallback.md");
  const sharePath = path.join(tempRoot, "exports", "pilot-launch-packet-share-fallback.md");
  const messagePath = path.join(tempRoot, "messages", "pilot-launch-packet-share-message-fallback.txt");

  const output = execFileSync("/bin/bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: binDir,
      PILOT_REHEARSAL_BUNDLE_DIR: bundleDir,
      PILOT_LAUNCH_PACKET_PATH: packetPath,
      PILOT_LAUNCH_PACKET_SHARE_PATH: sharePath,
      PILOT_LAUNCH_PACKET_MESSAGE_PATH: messagePath
    }
  });

  assert.match(output, /pilot_launch_packet_delivery_target=message file/);
  assert.equal(fs.existsSync(messagePath), true);
  assert.match(fs.readFileSync(messagePath, "utf8"), /Decision: GO/);
});
