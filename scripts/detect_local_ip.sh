#!/usr/bin/env bash
set -euo pipefail

detect_local_ip() {
  local default_iface=""
  local address=""
  local candidates=()

  default_iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [[ -n "${default_iface}" ]]; then
    candidates+=("${default_iface}")
  fi

  candidates+=("en0" "en1" "en9")

  for iface in "${candidates[@]}"; do
    [[ -n "${iface}" ]] || continue
    address="$(ipconfig getifaddr "${iface}" 2>/dev/null || true)"
    if [[ -n "${address}" && "${address}" != "127.0.0.1" ]]; then
      printf '%s\n' "${address}"
      return 0
    fi
  done

  address="$(
    python3 - <<'PY' 2>/dev/null || true
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 80))
    print(s.getsockname()[0])
except Exception:
    pass
finally:
    s.close()
PY
  )"

  if [[ -n "${address}" && "${address}" != "127.0.0.1" ]]; then
    printf '%s\n' "${address}"
    return 0
  fi

  printf '127.0.0.1\n'
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  detect_local_ip
fi
