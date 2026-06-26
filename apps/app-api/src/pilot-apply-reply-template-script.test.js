import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-apply-reply-template-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const docsDir = path.join(repoRoot, "docs");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_apply_reply_template.sh");
  const targetPath = path.join(scriptsDir, "pilot_apply_reply_template.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  return repoRoot;
}

test("reply template values are applied into the onboarding worksheet", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_apply_reply_template.sh");
  const onboardingPath = path.join(repoRoot, "docs", "pilot-onboarding-real.md");
  const replyTemplatePath = path.join(repoRoot, "tmp", "pilot-real-data-reply-template.txt");

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
      "- Executive sponsor:",
      "- Day-to-day club lead:",
      "- Launch decision owner:",
      "- Day-one operator:",
      "- Submitter accounts:",
      "- Reviewer accounts:",
      "- Escalation contact:",
      "",
      "Map real people to the workflow roles:",
      "",
      "- `organization_admin`:",
      "- `team_manager`:",
      "- `club_comms`:",
      "- `club_admin`:",
      "- Optional second approver:",
      "",
      "Record the real names used to create the first pilot users:",
      "",
      "- Submitter name and email:",
      "- Organization admin name and email:",
      "- Club admin name and email:",
      "- Club comms reviewer name and email:",
      "- Team manager reviewer name and email:",
      "",
      "## Workflow Policy Decisions",
      "",
      "- Default approver role: team_manager",
      "",
      "## Notification Decisions",
      "",
      "- Require real email delivery for launch:",
      "- Require real push delivery for launch:",
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

  fs.writeFileSync(
    replyTemplatePath,
    [
      "Candidate identity",
      "- Candidate profile name: north-river-real-pilot",
      "- Organization name: North River Sports Association",
      "- Organization slug: north-river-sports-association",
      "- Club name: North River Soccer Club",
      "- Club slug: north-river-soccer-club",
      "- Team names and slugs: 2014 Boys Blue / 2014-boys-blue",
      "- Age group: U12",
      "",
      "People and ownership",
      "- Executive sponsor: Sam Rivera",
      "- Day-to-day club lead: Taylor Nguyen",
      "- Launch decision owner: Taylor Nguyen <taylor@example.com>",
      "- Day-one operator: Chris Patel <chris@example.com>",
      "- Escalation contact: Morgan Lee <morgan@example.com>",
      "- Submitter name and email: Parent Poster <poster@example.com>",
      "- Organization admin name and email: Avery Ops <avery@example.com>",
      "- Club admin name and email: Jamie Club <jamie@example.com>",
      "- Club comms reviewer name and email: Riley Comms <riley@example.com>",
      "- Team manager reviewer name and email: Devon Manager <devon@example.com>",
      "",
      "Delivery and destinations",
      "- Require real email delivery for launch: yes",
      "- Require real push delivery for launch: no",
      "- Notification posture on day one: log-only email, no push",
      "",
      "Rollback",
      "- Rollback owner: Avery Ops",
      "- Rollback trigger: wrong reviewer receives first live submission",
      "- First override to remove if pilot behavior is wrong: club video route override",
      "- Scenarios to rerun after rollback: review_publish, public_video_policy",
      "- Pilot-club communication owner: Taylor Nguyen",
      "",
      "Live launch gate",
      "- Go-live owner signoff: Taylor Nguyen",
      "- Operator demo completed: yes",
      "- Mobile review smoke completed: passed",
      "- Pilot VPS scenario suite completed: completed",
      "- Open rollout blockers: clear"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, onboardingPath, replyTemplatePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_reply_template_source=.*pilot-real-data-reply-template\.txt/);
  assert.match(output, /pilot_reply_template_output=.*pilot-onboarding-real\.md/);
  assert.match(output, /pilot_reply_template_next_step=validate_onboarding/);

  const applied = fs.readFileSync(onboardingPath, "utf8");
  assert.match(applied, /- Candidate profile name: north-river-real-pilot/);
  assert.match(applied, /- Organization slug: north-river-sports-association/);
  assert.match(applied, /- Submitter accounts: Parent Poster <poster@example.com>/);
  assert.match(applied, /- Reviewer accounts: Avery Ops <avery@example.com>; Jamie Club <jamie@example.com>; Riley Comms <riley@example.com>; Devon Manager <devon@example.com>/);
  assert.match(applied, /- `club_comms`: Riley Comms <riley@example.com>/);
  assert.match(applied, /- Require real push delivery for launch: no/);
  assert.match(applied, /- Pilot VPS scenario suite completed: completed/);
  assert.match(applied, /- Rollback trigger: wrong reviewer receives first live submission/);
  assert.match(applied, /- Default approver role: team_manager/);
});
