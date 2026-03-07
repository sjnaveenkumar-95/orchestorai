#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PAPERCLIP_INSTANCE_ID="${PAPERCLIP_INSTANCE_ID:-default}"
export PAPERCLIP_DATA_DIR="${PAPERCLIP_DATA_DIR:-$HOME/.paperclip}"
export PAPERCLIP_RUNTIME_HOME="${PAPERCLIP_RUNTIME_HOME:-$PAPERCLIP_DATA_DIR}"
export PAPERCLIP_HOST_WORKSPACE_ROOT="${PAPERCLIP_HOST_WORKSPACE_ROOT:-$HOME/Workspace}"
export CODEX_ADDITIONAL_WRITABLE_DIRS="${CODEX_ADDITIONAL_WRITABLE_DIRS:-${PAPERCLIP_RUNTIME_HOME},/workspace/project,${PAPERCLIP_HOST_WORKSPACE_ROOT}}"

mkdir -p \
  "${PAPERCLIP_DATA_DIR}/docker" \
  "${PAPERCLIP_DATA_DIR}/instances/${PAPERCLIP_INSTANCE_ID}" \
  "${PAPERCLIP_DATA_DIR}/instances/${PAPERCLIP_INSTANCE_ID}/logs" \
  "${PAPERCLIP_DATA_DIR}/.cache/node/corepack" \
  "${PAPERCLIP_DATA_DIR}/.tmp"

PG_HBA_PATH="${PAPERCLIP_DATA_DIR}/docker/pg_hba.conf"
if [[ ! -f "$PG_HBA_PATH" ]]; then
  cat <<'EOF' > "$PG_HBA_PATH"
local   all             all                                     password
host    all             all             127.0.0.1/32            password
host    all             all             ::1/128                 password
host    all             all             0.0.0.0/0               password
host    all             all             ::/0                    password
local   replication     all                                     password
host    replication     all             127.0.0.1/32            password
host    replication     all             ::1/128                 password
host    replication     all             0.0.0.0/0               password
host    replication     all             ::/0                    password
EOF
fi

required_paths=(
  ".env"
  ".codex/auth.json"
  "${PG_HBA_PATH}"
)

for required_path in "${required_paths[@]}"; do
  if [[ ! -e "$required_path" ]]; then
    echo "[start-local-docker-stack] Missing required path: $required_path" >&2
    exit 1
  fi
done

export DOCKER_UID="$(id -u)"
export DOCKER_GID="$(id -g)"

compose_args=(
  -p paperclip-stack
  -f docker-compose.slack.yml
  -f docker-compose.local.yml
)

build_flag=""
if [[ "${PAPERCLIP_DOCKER_FORCE_BUILD:-}" =~ ^(1|true|yes|on)$ ]]; then
  build_flag="--build"
elif ! docker image inspect paperclip-stack-paperclip >/dev/null 2>&1; then
  build_flag="--build"
fi

if [[ -n "$build_flag" ]]; then
  docker compose \
    "${compose_args[@]}" \
    up -d \
    "$build_flag"
else
  docker compose \
    "${compose_args[@]}" \
    up -d
fi
