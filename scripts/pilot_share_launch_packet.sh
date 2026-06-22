#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

source_bundle_dir="${1:-${PILOT_REHEARSAL_BUNDLE_DIR:-}}"
packet_path="${PILOT_LAUNCH_PACKET_PATH:-${repo_root}/tmp/pilot-launch-packet.md}"
share_path="${PILOT_LAUNCH_PACKET_SHARE_PATH:-${repo_root}/tmp/pilot-launch-packet-share.md}"

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

echo "pilot_launch_packet_share_path=${share_path}"
echo "pilot_launch_packet_path=${packet_path}"
echo "pilot_launch_packet_source_bundle=${packet_source_bundle:-${source_bundle_dir}}"
