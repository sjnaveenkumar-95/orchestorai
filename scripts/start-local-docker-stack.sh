#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export ORCHESTORAI_INSTANCE_ID="${ORCHESTORAI_INSTANCE_ID:-default}"
export ORCHESTORAI_DATA_DIR="${ORCHESTORAI_DATA_DIR:-$HOME/.orchestorai}"
export ORCHESTORAI_RUNTIME_HOME="${ORCHESTORAI_RUNTIME_HOME:-$ORCHESTORAI_DATA_DIR}"
export ORCHESTORAI_HOST_WORKSPACE_ROOT="${ORCHESTORAI_HOST_WORKSPACE_ROOT:-$HOME/Workspace}"
export CODEX_ADDITIONAL_WRITABLE_DIRS="${CODEX_ADDITIONAL_WRITABLE_DIRS:-${ORCHESTORAI_RUNTIME_HOME},/workspace/project,${ORCHESTORAI_HOST_WORKSPACE_ROOT}}"

mkdir -p \
  "${ORCHESTORAI_DATA_DIR}/docker" \
  "${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}" \
  "${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}/logs" \
  "${ORCHESTORAI_DATA_DIR}/.cache/node/corepack" \
  "${ORCHESTORAI_DATA_DIR}/.tmp"

PG_HBA_PATH="${ORCHESTORAI_DATA_DIR}/docker/pg_hba.conf"
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
  -p orchestorai-stack
  -f docker-compose.slack.yml
  -f docker-compose.local.yml
)

build_flag=""
if [[ "${ORCHESTORAI_DOCKER_FORCE_BUILD:-}" =~ ^(1|true|yes|on)$ ]]; then
  build_flag="--build"
elif ! docker image inspect orchestorai-stack-orchestorai >/dev/null 2>&1; then
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
