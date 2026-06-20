#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
candidates_dir="${repo_root}/config/pilot-candidates"

echo "pilot_candidate_profiles"

shopt -s nullglob
profiles=("${candidates_dir}"/*.env)
shopt -u nullglob

if [[ "${#profiles[@]}" -eq 0 ]]; then
  echo "none"
  exit 0
fi

for profile_path in "${profiles[@]}"; do
  profile_file="$(basename "${profile_path}")"
  profile_name="${profile_file%.env}"

  case "${profile_file}" in
    *.local.env)
      profile_kind="local"
      ;;
    pilot-candidate.template.env)
      profile_kind="template"
      ;;
    *)
      profile_kind="committed"
      ;;
  esac

  echo "${profile_name}|${profile_kind}|${profile_file}"
done | sort
