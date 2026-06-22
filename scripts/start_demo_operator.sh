#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "${ROOT_DIR}/scripts/detect_local_ip.sh"

ADMIN_PORT="${ADMIN_PORT:-3013}"
MOBILE_PORT="${MOBILE_PORT:-8082}"
API_BASE_URL="${API_BASE_URL:-https://clubcontent-api.davmn.net}"
LOG_DIR="${LOG_DIR:-${ROOT_DIR}/.demo-logs}"
DETACH="${DETACH:-0}"
OPEN_MOBILE_ON_DETACH="${OPEN_MOBILE_ON_DETACH:-1}"
SIMULATOR_DEVICE_NAME="${SIMULATOR_DEVICE_NAME:-Club Content iPhone 17 Pro}"
XCRUN_BIN="${XCRUN_BIN:-xcrun}"

mkdir -p "${LOG_DIR}"

LOCAL_IP="${LOCAL_IP:-$(detect_local_ip)}"
EXPO_URL="${EXPO_URL:-exp://${LOCAL_IP}:${MOBILE_PORT}}"
MOBILE_STATUS_URL="${MOBILE_STATUS_URL:-http://127.0.0.1:${MOBILE_PORT}/status}"
DEMO_URL="http://127.0.0.1:${ADMIN_PORT}/demo"

is_listening() {
  local port="$1"
  lsof -iTCP:"${port}" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-40}"
  local sleep_seconds="${3:-1}"

  for ((i = 0; i < attempts; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  return 1
}

start_admin() {
  if is_listening "${ADMIN_PORT}"; then
    echo "Admin demo server already listening on ${ADMIN_PORT}."
    return
  fi

  (
    cd "${ROOT_DIR}"
    nohup env \
      API_BASE_URL="${API_BASE_URL}" \
      EXPO_URL="${EXPO_URL}" \
      MOBILE_STATUS_URL="${MOBILE_STATUS_URL}" \
      PORT="${ADMIN_PORT}" \
      node apps/admin-web/server.js \
      </dev/null > "${LOG_DIR}/admin-demo.log" 2>&1 &
    echo $! > "${LOG_DIR}/admin-demo.pid"
  )
}

start_mobile() {
  if is_listening "${MOBILE_PORT}"; then
    echo "Expo Metro already listening on ${MOBILE_PORT}."
    return
  fi

  (
    cd "${ROOT_DIR}"
    nohup npm --workspace @club/mobile run dev -- --port "${MOBILE_PORT}" \
      </dev/null > "${LOG_DIR}/mobile-demo.log" 2>&1 &
    echo $! > "${LOG_DIR}/mobile-demo.pid"
  )
}

resolve_simulator_udid() {
  "${XCRUN_BIN}" simctl list devices available |
    sed -n "s/^[[:space:]]*${SIMULATOR_DEVICE_NAME//\//\\/} (\\([0-9A-F-]\\{36\\}\\)).*/\\1/p" |
    head -n 1
}

find_existing_expo_go_app() {
  local device_udids
  device_udids="$("${XCRUN_BIN}" simctl list devices available | sed -n 's/.*(\([0-9A-F-]\{36\}\)).*/\1/p')"

  while IFS= read -r device_udid; do
    [[ -z "${device_udid}" ]] && continue
    if app_path="$("${XCRUN_BIN}" simctl get_app_container "${device_udid}" host.exp.Exponent app 2>/dev/null)"; then
      if [[ -n "${app_path}" ]]; then
        printf '%s' "${app_path}"
        return 0
      fi
    fi
  done <<< "${device_udids}"

  return 1
}

open_mobile_demo() {
  local simulator_udid
  simulator_udid="$(resolve_simulator_udid)"
  if [[ -z "${simulator_udid}" ]]; then
    echo "Could not resolve simulator named ${SIMULATOR_DEVICE_NAME}." >&2
    return 1
  fi

  "${XCRUN_BIN}" simctl boot "${simulator_udid}" >/dev/null 2>&1 || true
  "${XCRUN_BIN}" simctl bootstatus "${simulator_udid}" -b >/dev/null

  if ! "${XCRUN_BIN}" simctl get_app_container "${simulator_udid}" host.exp.Exponent app >/dev/null 2>&1; then
    local expo_go_app=""
    expo_go_app="$(find_existing_expo_go_app || true)"
    if [[ -z "${expo_go_app}" ]]; then
      echo "Expo Go is not installed on any simulator yet." >&2
      echo "Install it once on a simulator, then rerun npm run demo:operator." >&2
      return 1
    fi
    "${XCRUN_BIN}" simctl install "${simulator_udid}" "${expo_go_app}" >/dev/null
  fi

  "${XCRUN_BIN}" simctl launch "${simulator_udid}" host.exp.Exponent >/dev/null 2>&1 || true
  "${XCRUN_BIN}" simctl openurl "${simulator_udid}" "${EXPO_URL}?demoAction=load"
}

open_mobile_demo_if_available() {
  if ! command -v "${XCRUN_BIN}" >/dev/null 2>&1; then
    echo "Simulator launch skipped because ${XCRUN_BIN} is unavailable."
    return 0
  fi

  echo "Mobile runtime is ready. Opening the demo app on ${SIMULATOR_DEVICE_NAME}..."
  open_mobile_demo || true
}

start_admin

if ! wait_for_http "${DEMO_URL}" 30 1; then
  echo "Demo command center did not become ready at ${DEMO_URL}." >&2
  echo "Check ${LOG_DIR}/admin-demo.log" >&2
  exit 1
fi

cat <<EOF
Club Content demo is ready.

Demo command center: ${DEMO_URL}
Expo launch URL:     ${EXPO_URL}
Mobile status URL:   ${MOBILE_STATUS_URL}

Logs:
  Admin:  ${LOG_DIR}/admin-demo.log
  Mobile: ${LOG_DIR}/mobile-demo.log
EOF

if [[ "${DETACH}" == "1" ]]; then
  start_mobile
  if ! wait_for_http "${MOBILE_STATUS_URL}" 90 1; then
    echo "Expo Metro did not become ready at ${MOBILE_STATUS_URL}." >&2
    echo "Check ${LOG_DIR}/mobile-demo.log" >&2
    exit 1
  fi
  if [[ "${OPEN_MOBILE_ON_DETACH}" == "1" ]]; then
    open_mobile_demo_if_available
  fi
  exit 0
fi

cd "${ROOT_DIR}"
npm --workspace @club/mobile run dev -- --port "${MOBILE_PORT}" &
MOBILE_PID=$!
trap 'kill "${MOBILE_PID}" 2>/dev/null || true' EXIT INT TERM

if ! wait_for_http "${MOBILE_STATUS_URL}" 90 1; then
  echo "Expo Metro did not become ready at ${MOBILE_STATUS_URL}." >&2
  exit 1
fi

open_mobile_demo_if_available

wait "${MOBILE_PID}"
