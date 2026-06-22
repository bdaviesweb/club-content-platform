#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

DRY_RUN="${DRY_RUN:-0}"
runtime_root="${PILOT_DEMO_RUNTIME_ROOT:-${HOME}/.club-content-pilot-runtime}"
cache_dir="${runtime_root}/downloads"
bin_dir="${runtime_root}/bin"
build_dir="${runtime_root}/build"

arch="$(uname -m)"
case "${arch}" in
  arm64)
    minio_url="https://dl.min.io/server/minio/release/darwin-arm64/minio"
    ;;
  x86_64)
    minio_url="https://dl.min.io/server/minio/release/darwin-amd64/minio"
    ;;
  *)
    echo "Unsupported architecture: ${arch}" >&2
    exit 1
    ;;
esac

postgres_version="${POSTGRES_APP_VERSION:-2.9.5}"
postgres_major="${POSTGRES_APP_MAJOR:-16}"
postgres_url="${POSTGRES_APP_URL:-https://github.com/PostgresApp/PostgresApp/releases/download/v${postgres_version}/Postgres-${postgres_version}-${postgres_major}.dmg}"
redis_version="${REDIS_VERSION:-8.8.0}"
redis_url="${REDIS_URL:-https://download.redis.io/releases/redis-${redis_version}.tar.gz}"
postgres_dmg="${cache_dir}/Postgres-${postgres_version}-${postgres_major}.dmg"
redis_tarball="${cache_dir}/redis-${redis_version}.tar.gz"
minio_binary="${bin_dir}/minio"
activate_file="${runtime_root}/activate.sh"

log() {
  printf '%s\n' "$1"
}

run_cmd() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "DRY_RUN $*"
    return 0
  fi

  "$@"
}

mkdir -p "${cache_dir}" "${bin_dir}" "${build_dir}"

log "pilot_demo_runtime_root=${runtime_root}"
log "postgres_url=${postgres_url}"
log "redis_url=${redis_url}"
log "minio_url=${minio_url}"

run_cmd curl -fL "${postgres_url}" -o "${postgres_dmg}"
postgres_mount=""
if [[ "${DRY_RUN}" == "1" ]]; then
  log "DRY_RUN hdiutil attach ${postgres_dmg} -nobrowse"
  log "DRY_RUN detect mounted Postgres volume from hdiutil output"
  log "DRY_RUN rm -rf ${runtime_root}/Postgres.app"
  log "DRY_RUN ditto <mounted-postgres-volume>/Postgres.app ${runtime_root}/Postgres.app"
  log "DRY_RUN hdiutil detach <mounted-postgres-volume>"
else
  attach_output="$(hdiutil attach "${postgres_dmg}" -nobrowse)"
  postgres_mount="$(printf '%s\n' "${attach_output}" | awk 'END {print $NF}')"
  if [[ -z "${postgres_mount}" || ! -d "${postgres_mount}/Postgres.app" ]]; then
    echo "Could not find mounted Postgres.app volume after attaching ${postgres_dmg}." >&2
    printf '%s\n' "${attach_output}" >&2
    exit 1
  fi
  rm -rf "${runtime_root}/Postgres.app"
  ditto "${postgres_mount}/Postgres.app" "${runtime_root}/Postgres.app"
  hdiutil detach "${postgres_mount}"
fi

run_cmd curl -fL "${redis_url}" -o "${redis_tarball}"
if [[ "${DRY_RUN}" == "1" ]]; then
  log "DRY_RUN tar -xzf ${redis_tarball} -C ${build_dir}"
  log "DRY_RUN make -C ${build_dir}/redis-${redis_version}"
  log "DRY_RUN cp ${build_dir}/redis-${redis_version}/src/redis-server ${bin_dir}/redis-server"
  log "DRY_RUN cp ${build_dir}/redis-${redis_version}/src/redis-cli ${bin_dir}/redis-cli"
else
  rm -rf "${build_dir}/redis-${redis_version}"
  tar -xzf "${redis_tarball}" -C "${build_dir}"
  make -C "${build_dir}/redis-${redis_version}"
  cp "${build_dir}/redis-${redis_version}/src/redis-server" "${bin_dir}/redis-server"
  cp "${build_dir}/redis-${redis_version}/src/redis-cli" "${bin_dir}/redis-cli"
fi

run_cmd curl -fL "${minio_url}" -o "${minio_binary}"
run_cmd chmod +x "${minio_binary}"

cat > "${activate_file}" <<EOF
export PILOT_DEMO_RUNTIME_ROOT="${runtime_root}"
export PATH="${runtime_root}/bin:${runtime_root}/Postgres.app/Contents/Versions/${postgres_major}/bin:\$PATH"
EOF

log "pilot_demo_runtime_activate=${activate_file}"
log "Next:"
log "  source \"${activate_file}\""
log "  OPEN_SURFACES=0 npm run demo:pilot"
