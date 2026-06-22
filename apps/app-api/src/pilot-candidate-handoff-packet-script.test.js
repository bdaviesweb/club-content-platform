import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_candidate_handoff_packet.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-candidate-packet-"));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeProfile(filename, lines) {
  const profilePath = path.join(tempRoot, filename);
  fs.writeFileSync(profilePath, lines.join("\n"));
  return profilePath;
}

function writeBundle(rootName, bundleName, files = {}) {
  const bundleDir = path.join(tempRoot, rootName, bundleName);
  fs.mkdirSync(bundleDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(bundleDir, name), contents);
  }
  return bundleDir;
}

test("candidate handoff packet packages a validated profile with simulator evidence references", () => {
  const profilePath = writeProfile("candidate.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=real-candidate",
    "PILOT_CANDIDATE=real_candidate",
    'PILOT_ORGANIZATION_NAME="Real Organization"',
    "PILOT_ORGANIZATION_SLUG=real-org",
    "ORGANIZATION_SLUG=real-org",
    'PILOT_CLUB_NAME="Real Club"',
    "PILOT_CLUB_SLUG=real-club",
    "CLUB_SLUG=real-club",
    'PILOT_TEAM_NAME="Real Team"',
    "PILOT_TEAM_SLUG=real-team",
    "TEAM_SLUG=real-team",
    "SUBMITTER_EMAIL=submitter@real-club.local",
    "ORGANIZATION_ADMIN_EMAIL=org-admin@real-club.local",
    "CLUB_ADMIN_EMAIL=club-admin@real-club.local",
    "REVIEWER_EMAIL=club-comms@real-club.local",
    "TEAM_MANAGER_REVIEWER_EMAIL=team-manager@real-club.local",
    "PRIMARY_REVIEWER_EMAIL=team-manager@real-club.local",
    "SECOND_REVIEWER_EMAIL=club-admin@real-club.local"
  ]);
  const demoBundleDir = writeBundle("pilot-demo", "20260622T010000Z-simulated", {
    "summary.txt": "demo=ok\n"
  });
  const rehearsalBundleDir = writeBundle("pilot-rehearsal", "20260622T020000Z-simulated", {
    "handoff.md": "# Pilot Rehearsal Handoff\n",
    "summary.txt": "pilot_rehearsal_decision=GO\n",
    "status.txt": "inspect=ok\n"
  });
  const packetPath = path.join(tempRoot, "exports", "pilot-candidate-handoff.md");

  const output = execFileSync("bash", [scriptPath, profilePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PILOT_CANDIDATE_HANDOFF_PACKET_PATH: packetPath,
      PILOT_DEMO_OUTPUT_DIR: path.join(tempRoot, "pilot-demo"),
      PILOT_REHEARSAL_OUTPUT_DIR: path.join(tempRoot, "pilot-rehearsal")
    }
  });

  assert.match(output, /pilot_candidate_handoff_packet_path=.*pilot-candidate-handoff\.md/);
  assert.match(output, /pilot_candidate_handoff_profile=real-candidate/);
  assert.match(output, /pilot_candidate_handoff_decision=GO/);
  assert.match(output, new RegExp(`pilot_candidate_handoff_demo_bundle=${demoBundleDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, new RegExp(`pilot_candidate_handoff_rehearsal_bundle=${rehearsalBundleDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const packet = fs.readFileSync(packetPath, "utf8");
  assert.match(packet, /# Pilot Candidate Handoff Packet/);
  assert.match(packet, /Candidate profile: `real-candidate`/);
  assert.match(packet, /Decision: `GO`/);
  assert.match(packet, /Latest simulator demo bundle: `.*20260622T010000Z-simulated`/);
  assert.match(packet, /Latest simulator rehearsal bundle: `.*20260622T020000Z-simulated`/);
  assert.match(packet, /## Ownership Checklist/);
  assert.match(packet, /## Rollback Checklist/);
  assert.match(packet, /preflight_result=ok/);
});

test("candidate handoff packet surfaces a no-go packet when template values remain", () => {
  const profilePath = writeProfile("candidate-template.local.env", [
    "PILOT_CANDIDATE_PROFILE_NAME=template-candidate",
    "PILOT_CANDIDATE=template_candidate",
    'PILOT_ORGANIZATION_NAME="Replace With Organization Name"',
    "PILOT_ORGANIZATION_SLUG=replace-with-organization-slug",
    "ORGANIZATION_SLUG=replace-with-organization-slug",
    'PILOT_CLUB_NAME="Replace With Club Name"',
    "PILOT_CLUB_SLUG=replace-with-club-slug",
    "CLUB_SLUG=replace-with-club-slug",
    'PILOT_TEAM_NAME="Replace With Team Name"',
    "PILOT_TEAM_SLUG=replace-with-team-slug",
    "TEAM_SLUG=replace-with-team-slug",
    "SUBMITTER_EMAIL=submitter@example.com",
    "ORGANIZATION_ADMIN_EMAIL=org-admin@example.com",
    "CLUB_ADMIN_EMAIL=club-admin@example.com",
    "REVIEWER_EMAIL=club-comms@example.com",
    "TEAM_MANAGER_REVIEWER_EMAIL=team-manager@example.com"
  ]);
  const packetPath = path.join(tempRoot, "exports", "pilot-candidate-handoff-blocked.md");

  let output = "";
  try {
    output = execFileSync("bash", [scriptPath, profilePath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PILOT_CANDIDATE_HANDOFF_PACKET_PATH: packetPath,
        PILOT_DEMO_OUTPUT_DIR: path.join(tempRoot, "missing-demo"),
        PILOT_REHEARSAL_OUTPUT_DIR: path.join(tempRoot, "missing-rehearsal")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.fail("expected handoff packet generation to fail for a template profile");
  } catch (error) {
    assert.equal(error.status, 1);
    output = String(error.stdout || "");
  }

  assert.match(output, /pilot_candidate_handoff_decision=NO_GO/);

  const packet = fs.readFileSync(packetPath, "utf8");
  assert.match(packet, /Decision: `NO_GO`/);
  assert.match(packet, /Latest simulator demo bundle: `<missing>`/);
  assert.match(packet, /Latest simulator rehearsal bundle: `<missing>`/);
  assert.match(packet, /template placeholder values/);
});
