#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "start-production-terminals.sh currently supports macOS Terminal only" >&2
  exit 1
fi

shell_quote() {
  printf '%q' "$1"
}

build_terminal_command() {
  local title="$1"
  local target="$2"
  local shell_bin="${SHELL:-/bin/zsh}"
  local message="[$title] exited with status \$status"
  local command=""

  command+="cd $(shell_quote "$ROOT_DIR")"
  command+=" && printf '\\033]0;%s\\007' $(shell_quote "$title")"
  command+=" && ORCHESTORAI_SKIP_BUILD=true bash $(shell_quote "$ROOT_DIR/scripts/start-production-service.sh") $(shell_quote "$target")"
  command+="; status=\$?"
  command+="; echo"
  command+="; echo $(shell_quote "$message")"
  command+="; exec $(shell_quote "$shell_bin") -i"

  printf '%s\n' "$command"
}

launch_terminal() {
  local title="$1"
  local target="$2"
  local command
  command="$(build_terminal_command "$title" "$target")"

  echo "[start-production-terminals] launching $title"
  osascript - "$command" <<'APPLESCRIPT'
on run argv
  set launchCommand to item 1 of argv
  tell application "Terminal"
    activate
    do script launchCommand
  end tell
end run
APPLESCRIPT
}

echo "[start-production-terminals] building workspace"
pnpm build

launch_terminal "OrchestorAI Backend" "backend"
sleep 1
launch_terminal "OrchestorAI Frontend" "frontend"
sleep 1
launch_terminal "OrchestorAI Slack Bot" "slack-bot"
