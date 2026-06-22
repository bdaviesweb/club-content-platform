#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

request_path="${1:-${PILOT_REAL_DATA_REQUEST_PATH:-${repo_root}/tmp/pilot-real-data-request.md}}"
message_path="${2:-${PILOT_REAL_DATA_REQUEST_MESSAGE_PATH:-${repo_root}/tmp/pilot-real-data-request-message.txt}}"

if [[ ! -f "${request_path}" ]]; then
  echo "Missing real data request packet: ${request_path}" >&2
  exit 1
fi

source_line="$(sed -n 's/^- Source onboarding worksheet: `\(.*\)`/\1/p' "${request_path}" | head -n 1)"
gap_count="$(sed -n 's/^- Remaining gap count: `\(.*\)`/\1/p' "${request_path}" | head -n 1)"

creation_items="$(
  awk '
    /^## Needed Before Record Creation/ { in_creation=1; next }
    /^## Needed Before Live Launch/ { in_creation=0 }
    in_creation && /^- / { print }
  ' "${request_path}"
)"

launch_items="$(
  awk '
    /^## Needed Before Live Launch/ { in_launch=1; next }
    /^## Operator Notes/ { in_launch=0 }
    in_launch && /^- / { print }
  ' "${request_path}"
)"

mkdir -p "$(dirname "${message_path}")"

{
  echo "Subject: Club Content pilot setup details needed"
  echo
  echo "We prepared the pilot workflow defaults already. To create the first real pilot candidate safely, we still need a small set of real-club details."
  echo
  echo "Current request packet: ${request_path}"
  if [[ -n "${source_line}" ]]; then
    echo "Source worksheet: ${source_line}"
  fi
  if [[ -n "${gap_count}" ]]; then
    echo "Open items remaining: ${gap_count}"
  fi
  echo
  echo "Needed before we create records:"
  if [[ -n "${creation_items}" ]]; then
    printf '%s\n' "${creation_items}"
  else
    echo "- No remaining pre-creation items"
  fi
  echo
  echo "Needed before live launch:"
  if [[ -n "${launch_items}" ]]; then
    printf '%s\n' "${launch_items}"
  else
    echo "- No remaining live-launch items"
  fi
  echo
  echo "Once these are filled in, we can rerun the onboarding checks, generate the real candidate artifacts, and stop again before any hosted creation until the launch gate is explicitly green."
} > "${message_path}"

echo "pilot_real_data_request_share_path=${request_path}"
echo "pilot_real_data_request_message_path=${message_path}"
