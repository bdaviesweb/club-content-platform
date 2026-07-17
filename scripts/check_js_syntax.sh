#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

cd "${repo_root}"

status=0
while IFS= read -r file_path; do
  case "${file_path}" in
    apps/mobile/App.js|apps/mobile/ios/*|node_modules/*)
      continue
      ;;
  esac

  if ! node --check "${file_path}" >/dev/null; then
    status=1
  fi
done < <(rg --files -g '*.js' -g '!node_modules/**' -g '!apps/mobile/ios/**')

exit "${status}"
