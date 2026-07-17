import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_activation_audit.sh");

test("pilot activation audit defaults to the simulated pilot candidate", () => {
  const stubDir = path.join(currentDir, "__fixtures__", "pilot-activation-audit");
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      API_BASE_URL: "http://localhost:4000"
    }
  });

  assert.match(output, /pilot_org_slug=north-river-youth-sports/);
  assert.match(output, /pilot_club_slug=north-river-soccer-club/);
  assert.match(output, /pilot_team_slug=u13-girls-blue/);
  assert.match(output, /activation_decision=GO/);
});

test("pilot activation audit can target the legacy demo candidate explicitly", () => {
  const stubDir = path.join(currentDir, "__fixtures__", "pilot-activation-audit");
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      API_BASE_URL: "http://localhost:4000",
      PILOT_CANDIDATE: "demo",
      ALLOW_DEMO_IDENTITIES: "1"
    }
  });

  assert.match(output, /pilot_org_slug=demo-sports-org/);
  assert.match(output, /pilot_club_slug=demo-soccer-club/);
  assert.match(output, /pilot_team_slug=u14-girls/);
  assert.match(output, /activation_decision=GO/);
});

test("pilot activation audit blocks when pending workflow events are present", () => {
  const stubDir = path.join(currentDir, "__fixtures__", "pilot-activation-audit");

  const output = (() => {
    try {
      execFileSync("bash", [scriptPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH}`,
          API_BASE_URL: "http://localhost:4000",
          PILOT_PENDING_WORKFLOW_FIXTURE: "1"
        }
      });
      assert.fail("expected pilot activation audit to fail on pending workflow events");
    } catch (error) {
      assert.equal(error.status, 1);
      return String(error.stdout || "");
    }
  })();

  assert.match(output, /pending_workflow_count=1/);
  assert.match(output, /activation_decision=NO_GO/);
  assert.match(output, /blocker=Pending workflow events are present\. Pending items=1\./);
});
