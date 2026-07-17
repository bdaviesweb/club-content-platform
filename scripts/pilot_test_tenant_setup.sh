#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

simulator_profile="${PILOT_TEST_TENANT_PROFILE:-simulated-north-river}"
sandbox_intake_path="${PILOT_SANDBOX_INTAKE_PATH:-${repo_root}/docs/pilot-sandbox-intake.txt}"
workflow_settings_url="http://127.0.0.1:3013/workflow-settings?organizationMode=simulator&clubSlug=north-river-soccer-club"
demo_url="http://127.0.0.1:3013/demo"
review_url="http://127.0.0.1:3013/quick-review"

echo "pilot_test_tenant_profile=${simulator_profile}"
echo "pilot_test_tenant_intake=${sandbox_intake_path}"

echo "==> Rebuild fake candidate artifacts"
npm run pilot:sandbox
echo "pilot_test_tenant_sandbox=ok"

echo "==> Refresh simulator organization state"
if npm run pilot:simulator-state; then
  echo "pilot_test_tenant_simulator_state=ok"
else
  echo "pilot_test_tenant_simulator_state=blocked"
  echo "pilot_test_tenant_hint=start the local demo stack, then rerun npm run pilot:test-tenant"
fi

echo "pilot_test_tenant_decision=GO"
echo "pilot_test_tenant_next_1=npm run demo:pilot"
echo "pilot_test_tenant_next_2=npm run pilot:rehearse"
echo "pilot_test_tenant_next_3=${workflow_settings_url}"
echo "pilot_test_tenant_surface_demo=${demo_url}"
echo "pilot_test_tenant_surface_review=${review_url}"
echo "pilot_test_tenant_surface_workflow=${workflow_settings_url}"
