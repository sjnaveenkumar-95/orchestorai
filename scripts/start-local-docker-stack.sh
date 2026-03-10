#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export ORCHESTORAI_INSTANCE_ID="${ORCHESTORAI_INSTANCE_ID:-default}"
export ORCHESTORAI_DATA_DIR="${ORCHESTORAI_DATA_DIR:-$HOME/.orchestorai}"
export ORCHESTORAI_RUNTIME_HOME="${ORCHESTORAI_RUNTIME_HOME:-$ORCHESTORAI_DATA_DIR}"
export ORCHESTORAI_HOST_WORKSPACE_ROOT="${ORCHESTORAI_HOST_WORKSPACE_ROOT:-$HOME/Workspace}"
export CODEX_ADDITIONAL_WRITABLE_DIRS="${CODEX_ADDITIONAL_WRITABLE_DIRS:-${ORCHESTORAI_RUNTIME_HOME},/workspace/project,${ORCHESTORAI_HOST_WORKSPACE_ROOT}}"
export ORCHESTORAI_DOCKER_DB_MODE="${ORCHESTORAI_DOCKER_DB_MODE:-auto}"

detect_docker_mount_owner() {
  local host_path="$1"
  docker run --rm \
    -v "${host_path}:/mounted-path" \
    --entrypoint sh \
    node:lts-trixie-slim \
    -lc 'stat -c "%u:%g" /mounted-path' 2>/dev/null
}

mkdir -p \
  "${ORCHESTORAI_DATA_DIR}/docker" \
  "${ORCHESTORAI_DATA_DIR}/docker/postgres/${ORCHESTORAI_INSTANCE_ID}" \
  "${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}" \
  "${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}/logs" \
  "${ORCHESTORAI_DATA_DIR}/.cache/node/corepack" \
  "${ORCHESTORAI_DATA_DIR}/.tmp"

PG_HBA_PATH="${ORCHESTORAI_DATA_DIR}/docker/pg_hba.conf"
EMBEDDED_DB_VERSION_FILE="${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}/db/PG_VERSION"
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

if [[ -z "${ORCHESTORAI_DATABASE_URL+x}" ]]; then
  case "$ORCHESTORAI_DOCKER_DB_MODE" in
    embedded)
      export ORCHESTORAI_DATABASE_URL=""
      echo "[start-local-docker-stack] Reusing embedded instance DB at ${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}/db"
      ;;
    docker-postgres)
      ;;
    auto)
      if [[ -f "$EMBEDDED_DB_VERSION_FILE" ]]; then
        export ORCHESTORAI_DATABASE_URL=""
        echo "[start-local-docker-stack] Found embedded instance DB; reusing ${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}/db"
      fi
      ;;
    *)
      echo "[start-local-docker-stack] Unsupported ORCHESTORAI_DOCKER_DB_MODE: $ORCHESTORAI_DOCKER_DB_MODE" >&2
      echo "Expected one of: auto, embedded, docker-postgres" >&2
      exit 1
      ;;
  esac
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

detected_docker_uid=""
detected_docker_gid=""
if [[ "${ORCHESTORAI_DATABASE_URL-__unset__}" == "" ]] && [[ -z "${DOCKER_UID+x}" || -z "${DOCKER_GID+x}" ]]; then
  embedded_mount_owner="$(detect_docker_mount_owner "${ORCHESTORAI_DATA_DIR}/instances/${ORCHESTORAI_INSTANCE_ID}/db" || true)"
  if [[ "$embedded_mount_owner" =~ ^([0-9]+):([0-9]+)$ ]]; then
    detected_docker_uid="${BASH_REMATCH[1]}"
    detected_docker_gid="${BASH_REMATCH[2]}"
    echo "[start-local-docker-stack] Using container UID:GID ${detected_docker_uid}:${detected_docker_gid} to match embedded DB mount ownership"
  else
    echo "[start-local-docker-stack] Unable to detect embedded DB mount ownership inside Docker; falling back to host UID:GID" >&2
  fi
fi

export DOCKER_UID="${DOCKER_UID:-${detected_docker_uid:-$(id -u)}}"
export DOCKER_GID="${DOCKER_GID:-${detected_docker_gid:-$(id -g)}}"

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
