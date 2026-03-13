# @orchestorai/slack-channel-bot

OrchestorAI-specific Slack runtime for channels and group conversations.

This package keeps the existing OrchestorAI bridge behavior and channel ownership while using the shared `slack-agent-core` model adapter and utilities.

Supported local artifacts produced by Codex replies, such as screenshots and reports, are uploaded back into the same Slack thread automatically.

Start it with:

- `pnpm --filter @orchestorai/slack-channel-bot start`

Environment layout:

- package-local Slack env defaults to [packages/slack-channel-bot/.env.example](/Users/naveenkumar/Workspace/AI/AGI/OrchestorAI/packages/slack-channel-bot/.env.example#L1)
- override the env file with `SLACK_CHANNEL_BOT_ENV_FILE`
- OrchestorAI bridge env defaults to `~/.orchestorai/instances/default/.env`
- `CODEX_THINKING` and `CODEX_REASONING_EFFORT` map to Codex CLI `model_reasoning_effort` with `minimal|low|medium|high`

Channel ownership:

- `channel`
- `group`
- `mpim`

Direct messages are disabled by default in this package. The legacy `@orchestorai/slack-bot` wrapper can still opt into DM handling for backward compatibility.
