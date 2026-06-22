import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-real-data-request-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function copyScript(repoRoot, scriptName) {
  const sourcePath = path.resolve("scripts", scriptName);
  const targetPath = path.join(repoRoot, "scripts", scriptName);
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);
}

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "tmp"), { recursive: true });

  for (const scriptName of [
    "pilot_real_data_request_packet.sh",
    "pilot_real_onboarding_gaps.sh",
    "pilot_validate_onboarding.sh",
    "pilot_check_launch_readiness.sh"
  ]) {
    copyScript(repoRoot, scriptName);
  }

  return repoRoot;
}

test("real data request packet groups missing fields into creation and launch phases", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_real_data_request_packet.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const outputPath = path.join(repoRoot, "tmp", "pilot-real-data-request.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Real Club",
      "",
      "## Club Identity",
      "",
      "- Candidate profile name:",
      "- Organization name:",
      "- Organization slug:",
      "- Club name:",
      "- Club slug:",
      "- Team names and slugs:",
      "- Age group:",
      "",
      "## People and Roles",
      "",
      "- Launch decision owner:",
      "- Day-one operator:",
      "- Escalation contact:",
      "- Submitter name and email:",
      "- Organization admin name and email:",
      "- Club admin name and email:",
      "- Club comms reviewer name and email:",
      "- Team manager reviewer name and email:",
      "- Executive sponsor:",
      "- Day-to-day club lead:",
      "",
      "## Workflow Policy Decisions",
      "",
      "- Default approver role: team_manager",
      "- Public-content approver role: club_comms",
      "- Medium-risk approver role: club_comms",
      "- Allow Hermes agent routing: yes",
      "- Auto-approve low-risk internal content at organization level: yes",
      "- Auto-approve low-risk internal content at club effective level: no",
      "- Auto-approve max risk threshold: 0.35",
      "- Allowed auto-approval content types: photo",
      "- Should the club inherit org defaults unless explicitly noted: yes",
      "",
      "## Approval and Publishing Rules",
      "",
      "- Organization routing rule for `video`: club_admin",
      "- Club effective routing rule for `video`: team_manager",
      "- Organization public-content second approval: yes",
      "- Organization second approver role: club_admin",
      "- Organization second-approval content types: video",
      "- Club effective public-content second approval: no",
      "- Internal destinations: internal_feed",
      "- Public destinations: internal_feed",
      "",
      "## Notification Decisions",
      "",
      "- Require real email delivery for launch:",
      "- Require real push delivery for launch:",
      "- Organization notification default: email=true, push=true",
      "- Club effective notification baseline: email=false, push=false",
      "- Notification posture on day one:",
      "",
      "## Demo and QA Evidence",
      "",
      "- Operator demo completed:",
      "- Mobile review smoke completed:",
      "- Pilot VPS scenario suite completed:",
      "- Open rollout blockers:",
      "- Go-live owner signoff:",
      "",
      "## Rollback Plan",
      "",
      "- Rollback owner:",
      "- Rollback trigger:",
      "- First override to remove if pilot behavior is wrong:",
      "- Scenarios to rerun after rollback:",
      "- Pilot-club communication owner:"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, onboardingPath, outputPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_real_data_request_status=needs_input/);
  assert.match(output, /pilot_real_data_request_gap_count=/);

  const packet = fs.readFileSync(outputPath, "utf8");
  assert.match(packet, /## Needed Before Record Creation/);
  assert.match(packet, /### Candidate Identity/);
  assert.match(packet, /- Candidate profile name/);
  assert.match(packet, /### People and Ownership/);
  assert.match(packet, /- Executive sponsor/);
  assert.match(packet, /## Needed Before Live Launch/);
  assert.match(packet, /- Go-live owner signoff/);
  assert.match(packet, /- Operator demo completed/);
});

test("real data request packet reports ready when no onboarding gaps remain", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_real_data_request_packet.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");
  const outputPath = path.join(repoRoot, "tmp", "pilot-real-data-request.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Real Club",
      "",
      "## Club Identity",
      "",
      "- Candidate profile name: real-club-pilot",
      "- Organization name: Real Organization",
      "- Organization slug: real-organization",
      "- Club name: Real Club",
      "- Club slug: real-club",
      "- Team names and slugs: U13 Blue / u13-blue",
      "- Age group: U13",
      "",
      "## People and Roles",
      "",
      "- Launch decision owner: Taylor Director",
      "- Day-one operator: Casey Admin",
      "- Escalation contact: ops@realclub.org",
      "- Submitter name and email: Avery Coach <coach@realclub.org>",
      "- Organization admin name and email: Taylor Director <taylor@realclub.org>",
      "- Club admin name and email: Casey Admin <casey@realclub.org>",
      "- Club comms reviewer name and email: Riley Comms <riley@realclub.org>",
      "- Team manager reviewer name and email: Jordan Manager <jordan@realclub.org>",
      "- Executive sponsor: Taylor Director <taylor@realclub.org>",
      "- Day-to-day club lead: Casey Admin <casey@realclub.org>",
      "",
      "## Workflow Policy Decisions",
      "",
      "- Default approver role: team_manager",
      "- Public-content approver role: club_comms",
      "- Medium-risk approver role: club_comms",
      "- Allow Hermes agent routing: yes",
      "- Auto-approve low-risk internal content at organization level: yes",
      "- Auto-approve low-risk internal content at club effective level: no",
      "- Auto-approve max risk threshold: 0.35",
      "- Allowed auto-approval content types: photo",
      "- Should the club inherit org defaults unless explicitly noted: yes",
      "",
      "## Approval and Publishing Rules",
      "",
      "- Organization routing rule for `video`: club_admin",
      "- Club effective routing rule for `video`: team_manager",
      "- Organization public-content second approval: yes",
      "- Organization second approver role: club_admin",
      "- Organization second-approval content types: video",
      "- Club effective public-content second approval: no",
      "- Internal destinations: internal_feed",
      "- Public destinations: internal_feed",
      "",
      "## Notification Decisions",
      "",
      "- Require real email delivery for launch: no",
      "- Require real push delivery for launch: no",
      "- Organization notification default: email=true, push=true",
      "- Club effective notification baseline: email=false, push=false",
      "- Notification posture on day one: log-only with manual review",
      "",
      "## Demo and QA Evidence",
      "",
      "- Operator demo completed: yes",
      "- Mobile review smoke completed: passed",
      "- Pilot VPS scenario suite completed: completed",
      "- Open rollout blockers: none",
      "- Go-live owner signoff: Taylor Director",
      "",
      "## Rollback Plan",
      "",
      "- Rollback owner: Taylor Director",
      "- Rollback trigger: wrong reviewer routing",
      "- First override to remove if pilot behavior is wrong: org default auto-approval",
      "- Scenarios to rerun after rollback: submit, approve, publish",
      "- Pilot-club communication owner: Casey Admin"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, onboardingPath, outputPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_real_data_request_status=ready/);
  const packet = fs.readFileSync(outputPath, "utf8");
  assert.match(packet, /- No remaining launch-evidence gaps/);
});
