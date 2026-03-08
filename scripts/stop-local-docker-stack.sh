#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DOCKER_UID="$(id -u)"
export DOCKER_GID="$(id -g)"
export PAPERCLIP_INSTANCE_ID="${PAPERCLIP_INSTANCE_ID:-default}"
export PAPERCLIP_DATA_DIR="${PAPERCLIP_DATA_DIR:-$HOME/.paperclip}"
export PAPERCLIP_RUNTIME_HOME="${PAPERCLIP_RUNTIME_HOME:-$PAPERCLIP_DATA_DIR}"
export PAPERCLIP_HOST_WORKSPACE_ROOT="${PAPERCLIP_HOST_WORKSPACE_ROOT:-$HOME/Workspace}"
export CODEX_ADDITIONAL_WRITABLE_DIRS="${CODEX_ADDITIONAL_WRITABLE_DIRS:-${PAPERCLIP_RUNTIME_HOME},/workspace/project,${PAPERCLIP_HOST_WORKSPACE_ROOT}}"

docker compose \
  -p paperclip-stack \
  -f docker-compose.slack.yml \
  -f docker-compose.local.yml \
  down --remove-orphans
