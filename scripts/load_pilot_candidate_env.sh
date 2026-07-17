#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

pilot_profile="${1:-${PILOT_CANDIDATE_PROFILE:-}}"
script_is_sourced=0
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  script_is_sourced=1
fi

if [[ -z "${pilot_profile}" ]]; then
  if [[ "${script_is_sourced}" == "1" ]]; then
    return 0
  fi
  exit 0
fi

resolve_profile_path() {
  local profile="$1"
  local candidates_dir="${repo_root}/config/pilot-candidates"
  local direct_path="${profile}"
  local repo_relative_path="${repo_root}/${profile}"
  local named_env_path="${candidates_dir}/${profile}.env"
  local named_local_env_path="${candidates_dir}/${profile}.local.env"

  if [[ -f "${direct_path}" ]]; then
    printf '%s\n' "${direct_path}"
    return 0
  fi

  if [[ -f "${repo_relative_path}" ]]; then
    printf '%s\n' "${repo_relative_path}"
    return 0
  fi

  if [[ -f "${named_local_env_path}" ]]; then
    printf '%s\n' "${named_local_env_path}"
    return 0
  fi

  if [[ -f "${named_env_path}" ]]; then
    printf '%s\n' "${named_env_path}"
    return 0
  fi

  return 1
}

profile_path="$(resolve_profile_path "${pilot_profile}" || true)"

if [[ -z "${profile_path}" ]]; then
  echo "Unknown pilot candidate profile: ${pilot_profile}" >&2
  echo "Expected ${repo_root}/config/pilot-candidates/${pilot_profile}.env or ${pilot_profile}.local.env" >&2
  if [[ "${script_is_sourced}" == "1" ]]; then
    return 1
  fi
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${profile_path}"
set +a

export PILOT_CANDIDATE_PROFILE_PATH="${profile_path}"
