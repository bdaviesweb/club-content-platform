import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_readiness_vps.sh");

test("pilot readiness suite runs the expected default scenarios in order", () => {
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "1" }
  });

  assert.match(output, /Selected scenarios: review_publish auto_approval_override approval_override notification_override/);
  assert.match(output, /==> review_publish: Human review to publish baseline/);
  assert.match(output, /DRY_RUN scripts\/approval_publish_smoke_vps\.sh/);
  assert.match(output, /==> auto_approval_override: Organization default auto-approval with club override fallback/);
  assert.match(output, /DRY_RUN scripts\/auto_approval_override_smoke_vps\.sh/);
  assert.match(output, /==> approval_override: Organization second approval with club override bypass/);
  assert.match(output, /DRY_RUN scripts\/approval_override_smoke_vps\.sh/);
  assert.match(output, /==> notification_override: Organization notification defaults with club override replacement/);
  assert.match(output, /DRY_RUN scripts\/event_notification_rule_smoke_vps\.sh/);
  assert.match(output, /Pilot readiness scenario suite passed\./);
});

test("pilot readiness suite allows selecting a subset of scenarios", () => {
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "1", PILOT_SCENARIOS: "auto_approval_override,notification_override" }
  });

  assert.match(output, /Selected scenarios: auto_approval_override notification_override/);
  assert.doesNotMatch(output, /approval_publish_smoke_vps\.sh/);
  assert.match(output, /DRY_RUN scripts\/auto_approval_override_smoke_vps\.sh/);
  assert.match(output, /DRY_RUN scripts\/event_notification_rule_smoke_vps\.sh/);
});
