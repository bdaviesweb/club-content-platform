#!/usr/bin/env bash
set -euo pipefail

RUN_SIMULATOR_SMOKE="${RUN_SIMULATOR_SMOKE:-0}"
RUN_BATCH_SMOKE="${RUN_BATCH_SMOKE:-0}"
CLEAN_SMOKE_APPROVALS="${CLEAN_SMOKE_APPROVALS:-0}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"

if [[ "${CLEAN_SMOKE_APPROVALS}" == "1" ]]; then
  echo "Cleaning pending smoke approvals before mobile QA smoke..."
  APPLY=1 ./scripts/cleanup_smoke_approvals_vps.sh
fi

echo "Running mobile public API QA smoke..."
TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" ./scripts/mobile_qa_public_api_smoke.sh

if [[ "${RUN_SIMULATOR_SMOKE}" == "1" ]]; then
  echo "Running simulator-driven mobile demo review smoke..."
  TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" ./scripts/mobile_demo_review_smoke.sh
else
  echo "Skipping simulator-driven smoke. Set RUN_SIMULATOR_SMOKE=1 when Metro and a simulator are running."
fi

if [[ "${RUN_BATCH_SMOKE}" == "1" ]]; then
  echo "Running batch workflow simulation smoke..."
  TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" ./scripts/batch_workflow_simulation_smoke.sh
else
  echo "Skipping batch workflow simulation. Set RUN_BATCH_SMOKE=1 for multi-post manual and auto-approval coverage."
fi

echo "Mobile QA preflight passed."
