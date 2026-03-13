# @orchestorai/slack-bot

Compatibility wrapper around [`@orchestorai/slack-channel-bot`](/Users/naveenkumar/Workspace/AI/AGI/OrchestorAI/packages/slack-channel-bot) for the current OrchestorAI deployment and scripts.

This package preserves legacy behavior while the Slack runtime is split into:

- [`slack-agent-core`](/Users/naveenkumar/Workspace/AI/AGI/OrchestorAI/packages/slack-agent-core)
- [`slack-agent-dm`](/Users/naveenkumar/Workspace/AI/AGI/OrchestorAI/packages/slack-agent-dm)
- [`@orchestorai/slack-channel-bot`](/Users/naveenkumar/Workspace/AI/AGI/OrchestorAI/packages/slack-channel-bot)

Compatibility guarantees:

- `pnpm --filter @orchestorai/slack-bot start` still starts the OrchestorAI Slack runtime
- legacy `SLACK_CODEX_CONFIG` and `CODEX_*` settings still work
- DMs remain enabled when this wrapper is used
- DMs use a separate Codex adapter with `danger-full-access` plus the explicit bypass flag
- channels keep using the configured `CODEX_SANDBOX` value from the shared Slack env
- `CODEX_THINKING` and `CODEX_REASONING_EFFORT` map to Codex CLI `model_reasoning_effort` with `minimal|low|medium|high`
- supported local artifacts produced by Codex replies, such as screenshots and reports, are uploaded back into the same Slack thread automatically

Environment layout:

- Slack runtime env is now owned by [packages/slack-channel-bot/.env.example](/Users/naveenkumar/Workspace/AI/AGI/OrchestorAI/packages/slack-channel-bot/.env.example#L1) and can be overridden with `SLACK_CHANNEL_BOT_ENV_FILE`
- OrchestorAI bridge env defaults to `~/.orchestorai/instances/default/.env`
- Slack tokens stay in the channel-bot env file; OrchestorAI bridge values come from the OrchestorAI home env unless you override them in the Slack env

For new work, prefer:

- `pnpm --filter slack-agent-dm start` for reusable DM-only usage
- `pnpm --filter @orchestorai/slack-channel-bot start` for OrchestorAI channel usage
