#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

node --input-type=module <<'NODE'
import {
  getSimulatorOrganizationState,
  repairSimulatorOrganizationState,
  validateSimulatorOrganizationState
} from "./apps/app-api/src/simulator-org-state.js";

const state = getSimulatorOrganizationState(process.env);

console.log(`simulator_org_seed=${state.seed.organizationSlug}/${state.seed.slug}/${state.seed.teamSlug}`);
console.log(`simulator_org_memberships=${state.memberships.length}`);
console.log(`simulator_org_org_memberships=${state.organizationMembers.length}`);

try {
  await repairSimulatorOrganizationState({ env: process.env });
  console.log("simulator_org_reset=ok");

  const report = await validateSimulatorOrganizationState({ env: process.env });
  if (!report.ok) {
    for (const blocker of report.blockers) {
      console.log(`simulator_org_blocker=${blocker}`);
    }
    console.log("simulator_org_validate=failed");
    process.exit(1);
  }

  console.log("simulator_org_validate=ok");
  console.log(`simulator_org_organization=${report.state.organization?.slug || "n/a"}`);
  console.log(`simulator_org_club=${report.state.club?.slug || "n/a"}`);
  console.log(`simulator_org_admins=${report.state.organizationDirectory.admins.length}`);
  console.log(`simulator_org_clubs=${report.state.organizationDirectory.clubs.length}`);
} catch (error) {
  console.log(`simulator_org_error=${error?.code || error?.name || "unknown"}`);
  console.log("simulator_org_hint=start the local database stack first, then rerun npm run pilot:simulator-state");
  process.exit(1);
}
NODE
