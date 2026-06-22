#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

source_bundle_dir="${1:-${PILOT_REHEARSAL_BUNDLE_DIR:-}}"
packet_path="${PILOT_LAUNCH_PACKET_PATH:-${repo_root}/tmp/pilot-launch-packet.md}"
share_path="${PILOT_LAUNCH_PACKET_SHARE_PATH:-${repo_root}/tmp/pilot-launch-packet-share.md}"
message_path="${PILOT_LAUNCH_PACKET_MESSAGE_PATH:-${repo_root}/tmp/pilot-launch-packet-share-message.txt}"

if [[ -n "${source_bundle_dir}" ]]; then
  packet_output="$(
    env PILOT_REHEARSAL_BUNDLE_DIR="${source_bundle_dir}" PILOT_LAUNCH_PACKET_PATH="${packet_path}" \
      bash "${script_dir}/pilot_launch_packet.sh"
  )"
else
  packet_output="$(env PILOT_LAUNCH_PACKET_PATH="${packet_path}" bash "${script_dir}/pilot_launch_packet.sh")"
fi

printf '%s\n' "${packet_output}"

packet_source_bundle="$(
  printf '%s\n' "${packet_output}" | sed -n 's/^pilot_launch_packet_source_bundle=//p' | tail -n 1
)"

mkdir -p "$(dirname "${share_path}")"
cp "${packet_path}" "${share_path}"

evidence_path="$(grep -m1 '^- Evidence path:' "${share_path}" | sed -E 's/^- Evidence path: `([^`]+)`$/\1/')"
decision="$(grep -m1 '^- Decision:' "${share_path}" | sed -E 's/^- Decision: `([^`]+)`$/\1/')"
blockers_summary="none"
if grep -q '^## Blockers' "${share_path}"; then
  blockers_summary="$(
    awk '
      /^## Blockers$/ { in_blockers = 1; next }
      /^## / { in_blockers = 0 }
      in_blockers && /^- / { sub(/^- /, ""); print }
    ' "${share_path}" | paste -sd '; ' -
  )"
  if [[ -z "${blockers_summary}" ]]; then
    blockers_summary="none"
  fi
fi

message_body=$(
  cat <<EOF
Pilot launch packet ready.

Packet file: ${share_path}
Evidence path: ${evidence_path}
Decision: ${decision}
Blockers: ${blockers_summary}

Key links:
- Demo command center: http://127.0.0.1:3013/demo
- Quick review: http://127.0.0.1:3013/quick-review
- Workflow settings: http://127.0.0.1:3013/workflow-settings?clubSlug=north-river-soccer-club
- Internal feed API: https://clubcontent-api.davmn.net/feed/internal?includeSmoke=1
EOF
)

mkdir -p "$(dirname "${message_path}")"
printf '%s\n' "${message_body}" > "${message_path}"

clipboard_target="message file"
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "${message_body}" | pbcopy
  clipboard_target="pbcopy"
fi

echo "pilot_launch_packet_share_path=${share_path}"
echo "pilot_launch_packet_message_path=${message_path}"
echo "pilot_launch_packet_message_target=${clipboard_target}"
echo "pilot_launch_packet_path=${packet_path}"
echo "pilot_launch_packet_source_bundle=${packet_source_bundle:-${source_bundle_dir}}"
