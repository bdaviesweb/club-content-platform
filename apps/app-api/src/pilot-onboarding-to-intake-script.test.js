import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-onboarding-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_onboarding_to_intake.sh");
  const targetPath = path.join(scriptsDir, "pilot_onboarding_to_intake.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  return repoRoot;
}

test("pilot onboarding worksheet converts to a candidate intake block", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_onboarding_to_intake.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: North River Youth Sports",
      "",
      "## Club Identity",
      "",
      "- Candidate profile name: north-river-pilot",
      "- Organization name: `North River Youth Sports`",
      "- Organization slug: `north-river-youth-sports`",
      "- Club name: `North River Soccer Club`",
      "- Club slug: `north-river-soccer-club`",
      "- Team names and slugs: `U13 Girls Blue` / `u13-girls-blue`",
      "- Age group: `U13`",
      "",
      "## People and Roles",
      "",
      "- Launch decision owner: `Nora Operations`",
      "- Day-one operator: `Casey Admin`",
      "- Escalation contact: `Nora Operations` <`ops@northriverpilot.local`>",
      "- Submitter name and email: `Avery Coach` <`coach@northriverpilot.local`>",
      "- Organization admin name and email: `Nora Operations` <`ops@northriverpilot.local`>",
      "- Club admin name and email: `Casey Admin` <`admin@northriverpilot.local`>",
      "- Club comms reviewer name and email: `Riley Comms` <`comms@northriverpilot.local`>",
      "- Team manager reviewer name and email: `Jordan Manager` <`manager@northriverpilot.local`>",
      "",
      "## Workflow Policy Decisions",
      "",
      "- Default approver role: `team_manager`",
      "- Public-content approver role: `club_comms`",
      "- Medium-risk approver role: `club_comms`",
      "- Allow Hermes agent routing: `yes`",
      "- Auto-approve low-risk internal content at organization level: `yes`",
      "- Auto-approve low-risk internal content at club effective level: `no`",
      "- Auto-approve max risk threshold: `0.35`",
      "- Allowed auto-approval content types: `photo`",
      "",
      "## Approval and Publishing Rules",
      "",
      "- Organization routing rule for `video`: `club_admin`",
      "- Should the club inherit org defaults unless explicitly noted: `yes`",
      "- Organization public-content second approval: `yes`",
      "- Organization second approver role: `club_admin`",
      "- Organization second-approval content types: `video`",
      "- Club effective routing rule for `video`: `team_manager`",
      "- Club effective public-content second approval: `no`",
      "",
      "## Notification Decisions",
      "",
      "- Require real email delivery for launch: `no`",
      "- Require real push delivery for launch: `no`",
      "- Organization notification default: `email=true`, `push=true`",
      "- Club effective notification baseline: `email=false`, `push=false`",
      "- Notification posture on day one: `log-only with manual verification`",
      "- Known delivery limitations or accepted gaps: log-only with manual verification",
      "",
      "## Rollback Plan",
      "",
      "- Rollback owner: `Nora Operations`",
      "- Rollback trigger: wrong reviewer routing or unexpected publish behavior",
      "- First override to remove if pilot behavior is wrong: organization default auto-approval",
      "- Scenarios to rerun after rollback: submit photo, submit video, approve, publish",
      "- Pilot-club communication owner: `Casey Admin`"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, onboardingPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /^candidate_profile_name=north-river-pilot$/m);
  assert.match(output, /^organization_slug=north-river-youth-sports$/m);
  assert.match(output, /^team_slug=u13-girls-blue$/m);
  assert.match(output, /^submitter_email=coach@northriverpilot\.local$/m);
  assert.match(output, /^organization_admin_email=ops@northriverpilot\.local$/m);
  assert.match(output, /^default_approver_role=team_manager$/m);
  assert.match(output, /^allow_agent_routing=yes$/m);
  assert.match(output, /^auto_approval_content_types=photo$/m);
  assert.match(output, /^routing_video_approver_role=club_admin$/m);
  assert.match(output, /^require_email_delivery=no$/m);
  assert.match(output, /^require_push_delivery=no$/m);
  assert.match(output, /^org_notification_email=yes$/m);
  assert.match(output, /^org_notification_push=yes$/m);
  assert.match(output, /^club_notification_email=no$/m);
  assert.match(output, /^club_notification_push=no$/m);
  assert.match(output, /^notification_posture=log-only with manual verification$/m);
  assert.match(output, /^rollback_owner=Nora Operations$/m);
});

test("pilot onboarding conversion falls back to a club-slug-based candidate profile when needed", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_onboarding_to_intake.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding.md");

  fs.writeFileSync(
    onboardingPath,
    [
      "# Pilot Club Onboarding: Demo Sports Organization",
      "",
      "## Club Identity",
      "",
      "- Organization name: Demo Sports Organization",
      "- Organization slug: demo-sports-org",
      "- Club name: Demo Soccer Club",
      "- Club slug: demo-soccer-club",
      "- Team names and slugs: u14-girls",
      "- Age group: U14"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, onboardingPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /^candidate_profile_name=demo-soccer-club-pilot$/m);
  assert.match(output, /^team_name=u14-girls$/m);
});
