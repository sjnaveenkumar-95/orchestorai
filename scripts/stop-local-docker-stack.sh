#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DOCKER_UID="$(id -u)"
export DOCKER_GID="$(id -g)"
export ORCHESTORAI_INSTANCE_ID="${ORCHESTORAI_INSTANCE_ID:-default}"
export ORCHESTORAI_DATA_DIR="${ORCHESTORAI_DATA_DIR:-$HOME/.orchestorai}"
export ORCHESTORAI_RUNTIME_HOME="${ORCHESTORAI_RUNTIME_HOME:-$ORCHESTORAI_DATA_DIR}"
export ORCHESTORAI_HOST_WORKSPACE_ROOT="${ORCHESTORAI_HOST_WORKSPACE_ROOT:-$HOME/Workspace}"
export CODEX_ADDITIONAL_WRITABLE_DIRS="${CODEX_ADDITIONAL_WRITABLE_DIRS:-${ORCHESTORAI_RUNTIME_HOME},/workspace/project,${ORCHESTORAI_HOST_WORKSPACE_ROOT}}"

docker compose \
  -p orchestorai-stack \
  -f docker-compose.slack.yml \
  -f docker-compose.local.yml \
  down --remove-orphans
