#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

source_bundle_dir="${1:-${PILOT_REHEARSAL_BUNDLE_DIR:-}}"
packet_path="${PILOT_LAUNCH_PACKET_PATH:-${repo_root}/tmp/pilot-launch-packet.md}"
rehearsal_output_dir="${PILOT_REHEARSAL_OUTPUT_DIR:-${repo_root}/tmp/pilot-rehearsal}"

latest_bundle_dir() {
  local bundle_root="${rehearsal_output_dir}"
  if [[ ! -d "${bundle_root}" ]]; then
    return 1
  fi

  find "${bundle_root}" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1
}

if [[ -z "${source_bundle_dir}" ]]; then
  source_bundle_dir="$(latest_bundle_dir || true)"
fi

if [[ -z "${source_bundle_dir}" || ! -d "${source_bundle_dir}" ]]; then
  echo "Could not find a rehearsal bundle directory." >&2
  echo "Pass a bundle path or run npm run pilot:rehearse first." >&2
  exit 1
fi

handoff_file="${source_bundle_dir}/handoff.md"
summary_file="${source_bundle_dir}/summary.txt"
status_file="${source_bundle_dir}/status.txt"

if [[ ! -f "${handoff_file}" ]]; then
  echo "Missing handoff file: ${handoff_file}" >&2
  exit 1
fi

mkdir -p "$(dirname "${packet_path}")"

packet_title="Pilot Launch Packet"

{
  echo "# ${packet_title}"
  echo
  echo "- Source bundle: \`${source_bundle_dir}\`"
  echo "- Handoff file: \`${handoff_file}\`"
  echo "- Summary file: \`${summary_file}\`"
  echo "- Status file: \`${status_file}\`"
  echo "- Output packet: \`${packet_path}\`"
  echo
  echo "## Portable Handoff"
  echo
  cat "${handoff_file}"
  echo
  echo "## Copy Notes"
  echo
  echo "- Share this file as the single launch packet."
  echo "- The bundle path above points to the preserved evidence behind the packet."
} > "${packet_path}"

echo "pilot_launch_packet_path=${packet_path}"
echo "pilot_launch_packet_source_bundle=${source_bundle_dir}"
