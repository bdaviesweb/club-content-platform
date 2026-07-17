import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "club-content-pilot-share-real-data-request-"));

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function setupFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(fixtureRoot, "repo-"));
  const scriptsDir = path.join(repoRoot, "scripts");
  const tmpDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const sourcePath = path.resolve("scripts", "pilot_share_real_data_request.sh");
  const targetPath = path.join(scriptsDir, "pilot_share_real_data_request.sh");
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);

  return repoRoot;
}

test("share real data request creates a plain-language message from the request packet", () => {
  const repoRoot = setupFixtureRepo();
  const scriptPath = path.join(repoRoot, "scripts", "pilot_share_real_data_request.sh");
  const requestPath = path.join(repoRoot, "tmp", "pilot-real-data-request.md");
  const messagePath = path.join(repoRoot, "tmp", "pilot-real-data-request-message.txt");

  fs.writeFileSync(
    requestPath,
    [
      "# Pilot Real Data Request",
      "",
      "- Source onboarding worksheet: `tmp/pilot-onboarding-real-candidate.md`",
      "- Remaining gap count: `12`",
      "",
      "## Needed Before Record Creation",
      "",
      "- Candidate profile name",
      "- Organization name",
      "- Launch decision owner",
      "",
      "## Needed Before Live Launch",
      "",
      "- Go-live owner signoff",
      "- Operator demo completed",
      "",
      "## Operator Notes"
    ].join("\n")
  );

  const output = execFileSync("bash", [scriptPath, requestPath, messagePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.match(output, /pilot_real_data_request_share_path=.*pilot-real-data-request\.md/);
  assert.match(output, /pilot_real_data_request_message_path=.*pilot-real-data-request-message\.txt/);

  const message = fs.readFileSync(messagePath, "utf8");
  assert.match(message, /Subject: Club Content pilot setup details needed/);
  assert.match(message, /Open items remaining: 12/);
  assert.match(message, /Needed before we create records:/);
  assert.match(message, /- Candidate profile name/);
  assert.match(message, /Needed before live launch:/);
  assert.match(message, /- Go-live owner signoff/);
});
