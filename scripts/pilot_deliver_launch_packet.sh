#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

delivery_output="$(
  bash "${script_dir}/pilot_share_launch_packet.sh" "$@"
)"

printf '%s\n' "${delivery_output}"

message_path="$(
  printf '%s\n' "${delivery_output}" | sed -n 's/^pilot_launch_packet_message_path=//p' | tail -n 1
)"
share_path="$(
  printf '%s\n' "${delivery_output}" | sed -n 's/^pilot_launch_packet_share_path=//p' | tail -n 1
)"

if [[ -z "${message_path}" || -z "${share_path}" ]]; then
  echo "Could not determine the share packet or message body path." >&2
  exit 1
fi

if command -v open >/dev/null 2>&1; then
  open "${message_path}" "${share_path}"
  open_target="open"
else
  open_target="message file"
fi

echo "pilot_launch_packet_delivery_target=${open_target}"
echo "pilot_launch_packet_delivery_message_path=${message_path}"
echo "pilot_launch_packet_delivery_share_path=${share_path}"
