import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(repoRoot, "scripts/pilot_rehearsal.sh");

test("pilot rehearsal script runs the full simulator flow in order", () => {
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      PILOT_CANDIDATE_PROFILE: "simulated-north-river"
    }
  });

  assert.match(output, /pilot_rehearsal_profile=simulated-north-river/);
  assert.match(output, /pilot_rehearsal_profile_path=.*simulated-north-river\.env/);
  assert.match(output, /==> Inspect simulator profile/);
  assert.match(output, /DRY_RUN npm run pilot:inspect -- simulated-north-river/);
  assert.match(output, /==> Validate simulator profile/);
  assert.match(
    output,
    /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river bash scripts\/validate_pilot_candidate_profile\.sh/
  );
  assert.match(output, /==> Run backend audit/);
  assert.match(output, /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:audit/);
  assert.match(output, /==> Run VPS rehearsal/);
  assert.match(output, /DRY_RUN env PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:vps/);
  assert.match(output, /==> Verify demo UI contract/);
  assert.match(output, /DRY_RUN node --test .*apps\/admin-web\/server\.test\.js/);
  assert.match(output, /pilot_rehearsal_result=ok/);
});

test("pilot rehearsal script defaults to the committed simulator profile", () => {
  const output = execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1"
    }
  });

  assert.match(output, /pilot_rehearsal_profile=simulated-north-river/);
  assert.match(output, /DRY_RUN npm run pilot:inspect -- simulated-north-river/);
});
