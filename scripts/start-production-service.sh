#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

trim_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

is_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_path() {
  node --input-type=module - "$1" "$2" <<'NODE'
import path from "node:path";

const [, , baseDir, target] = process.argv;
let value = String(target || "");
if (value === "~") {
  value = process.env.HOME || "";
} else if (value.startsWith("~/")) {
  value = path.join(process.env.HOME || "", value.slice(2));
}
console.log(path.resolve(baseDir, value));
NODE
}

resolve_csv_paths() {
  node --input-type=module - "$1" "$2" <<'NODE'
import path from "node:path";

const [, , baseDir, raw] = process.argv;
const resolved = String(raw || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    if (entry === "~") {
      return process.env.HOME || "";
    }
    if (entry.startsWith("~/")) {
      return path.join(process.env.HOME || "", entry.slice(2));
    }
    return path.resolve(baseDir, entry);
  });
console.log(resolved.join(","));
NODE
}

load_env_file_defaults() {
  local env_path="$1"
  if [[ ! -f "$env_path" ]]; then
    return 0
  fi

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line="${raw_line%$'\r'}"
    local trimmed
    trimmed="$(trim_whitespace "$line")"
    if [[ -z "$trimmed" || "$trimmed" == \#* || "$trimmed" != *=* ]]; then
      continue
    fi

    local key="${trimmed%%=*}"
    local value="${trimmed#*=}"
    key="$(trim_whitespace "$key")"
    value="$(trim_whitespace "$value")"
    if [[ -z "$key" ]]; then
      continue
    fi
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$env_path"
}

resolve_slack_channel_env_path() {
  local configured_path="${SLACK_CHANNEL_BOT_ENV_FILE:-${SLACK_BOT_ENV_FILE:-}}"
  if [[ -n "$configured_path" ]]; then
    resolve_path "$ROOT_DIR" "$configured_path"
    return
  fi
  printf '%s\n' "$ROOT_DIR/packages/slack-channel-bot/.env"
}

resolve_orchestorai_env_path() {
  if [[ -n "${ORCHESTORAI_ENV_FILE:-}" ]]; then
    resolve_path "$ROOT_DIR" "$ORCHESTORAI_ENV_FILE"
    return
  fi

  if [[ -n "${ORCHESTORAI_CONFIG:-}" ]]; then
    node --input-type=module - "$ROOT_DIR" "$ORCHESTORAI_CONFIG" <<'NODE'
import path from "node:path";

const [, , rootDir, configPath] = process.argv;
console.log(path.resolve(path.dirname(path.resolve(rootDir, configPath)), ".env"));
NODE
    return
  fi

  local home_dir
  if [[ -n "${ORCHESTORAI_HOME:-}" ]]; then
    home_dir="$(resolve_path "$ROOT_DIR" "$ORCHESTORAI_HOME")"
  else
    home_dir="${HOME:-$ROOT_DIR}/.orchestorai"
  fi
  local instance_id="${ORCHESTORAI_INSTANCE_ID:-default}"
  printf '%s\n' "$home_dir/instances/$instance_id/.env"
}

bootstrap_frontend_env() {
  local env_path
  env_path="$(resolve_orchestorai_env_path)"
  if [[ -f "$env_path" ]]; then
    echo "[start-production-service] loading OrchestorAI defaults for frontend from $env_path"
    load_env_file_defaults "$env_path"
  fi

  if [[ -z "${ORCHESTORAI_API_URL:-}" ]]; then
    export ORCHESTORAI_API_URL="http://127.0.0.1:${PORT:-3100}"
  fi

  export VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-$ORCHESTORAI_API_URL}"
}

bootstrap_slack_dm_env() {
  local had_data_dir=0
  if [[ -n "${DATA_DIR+x}" && -n "${DATA_DIR:-}" ]]; then
    had_data_dir=1
  fi

  local env_path
  env_path="$(resolve_slack_channel_env_path)"
  local env_dir="$ROOT_DIR/packages/slack-channel-bot"
  if [[ -f "$env_path" ]]; then
    env_dir="$(dirname "$env_path")"
    echo "[start-production-service] loading Slack defaults for slack-dm from $env_path"
    load_env_file_defaults "$env_path"
  fi

  export MODEL_PROVIDER="${MODEL_PROVIDER:-codex_cli}"

  if [[ -z "${MODEL_CODEX_COMMAND:-}" && -n "${CODEX_COMMAND:-}" ]]; then
    export MODEL_CODEX_COMMAND="$CODEX_COMMAND"
  fi
  if [[ -z "${MODEL_CODEX_MODEL:-}" && -n "${CODEX_MODEL:-}" ]]; then
    export MODEL_CODEX_MODEL="$CODEX_MODEL"
  fi
  if [[ -z "${MODEL_CODEX_PROFILE:-}" && -n "${CODEX_PROFILE:-}" ]]; then
    export MODEL_CODEX_PROFILE="$CODEX_PROFILE"
  fi
  if [[ -z "${MODEL_CODEX_THINKING:-}" ]]; then
    if [[ -n "${CODEX_THINKING:-}" ]]; then
      export MODEL_CODEX_THINKING="$CODEX_THINKING"
    elif [[ -n "${CODEX_REASONING_EFFORT:-}" ]]; then
      export MODEL_CODEX_THINKING="$CODEX_REASONING_EFFORT"
    fi
  fi
  if [[ -z "${MODEL_CODEX_SANDBOX:-}" && -n "${CODEX_SANDBOX:-}" ]]; then
    export MODEL_CODEX_SANDBOX="$CODEX_SANDBOX"
  fi
  if [[ -z "${MODEL_CODEX_ADDITIONAL_WRITABLE_DIRS:-}" && -n "${CODEX_ADDITIONAL_WRITABLE_DIRS:-}" ]]; then
    export MODEL_CODEX_ADDITIONAL_WRITABLE_DIRS="$(resolve_csv_paths "$env_dir" "$CODEX_ADDITIONAL_WRITABLE_DIRS")"
  fi
  if [[ -z "${MODEL_TIMEOUT_MS:-}" && -n "${CODEX_TIMEOUT_MS:-}" ]]; then
    export MODEL_TIMEOUT_MS="$CODEX_TIMEOUT_MS"
  fi
  if [[ -z "${MODEL_SYSTEM_PROMPT:-}" && -n "${CODEX_SYSTEM_PROMPT:-}" ]]; then
    export MODEL_SYSTEM_PROMPT="$CODEX_SYSTEM_PROMPT"
  fi
  if [[ -z "${MODEL_WORKDIR:-}" ]]; then
    if [[ -n "${CODEX_WORKDIR:-}" ]]; then
      export MODEL_WORKDIR="$(resolve_path "$env_dir" "$CODEX_WORKDIR")"
    else
      export MODEL_WORKDIR="$ROOT_DIR"
    fi
  fi
  if [[ "$had_data_dir" -eq 0 ]]; then
    export DATA_DIR="$ROOT_DIR/packages/slack-agent-dm/data"
  fi
}

usage() {
  cat <<'EOF' >&2
Usage: bash scripts/start-production-service.sh <target>

Targets:
  backend        Build and start the OrchestorAI backend in production mode
  frontend       Build and start the standalone UI preview on 0.0.0.0:4173
  slack-bot      Build and start the combined OrchestorAI Slack bot
  slack-channel  Compatibility alias for slack-bot
  slack-dm       Build and start the reusable Slack DM bot
  stack          Build and start the integrated production stack
EOF
}

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  usage
  exit 1
fi
shift || true

case "$TARGET" in
  backend)
    COMMAND=(pnpm --filter @orchestorai/server exec tsx dist/index.js "$@")
    ;;
  frontend|ui)
    bootstrap_frontend_env
    COMMAND=(pnpm --filter @orchestorai/ui preview --host 0.0.0.0 --port 4173 "$@")
    ;;
  slack-bot|bot|slack-channel|channel)
    COMMAND=(pnpm --filter @orchestorai/slack-bot start "$@")
    ;;
  slack-dm|dm)
    bootstrap_slack_dm_env
    COMMAND=(pnpm --filter slack-agent-dm start "$@")
    ;;
  stack)
    COMMAND=(env ORCHESTORAI_SLACK_ENABLED=true pnpm start:stack "$@")
    ;;
  *)
    usage
    exit 1
    ;;
esac

if is_truthy "${ORCHESTORAI_SKIP_BUILD:-}"; then
  echo "[start-production-service] skipping workspace build"
else
  echo "[start-production-service] building workspace"
  pnpm build
fi

exec "${COMMAND[@]}"
