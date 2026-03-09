# OrchestorAI Slack Bot

This workspace package contains the Slack + Codex runtime that is currently bridged to OrchestorAI.

It preserves the current behavior:

- Slack assistant replies through the local Codex CLI
- explicit `@orchestorai task:` issue creation
- OrchestorAI project and agent alias mapping
- Slack thread <-> OrchestorAI issue linking
- high-signal OrchestorAI updates mirrored back into Slack
- child OrchestorAI issues creating their own Slack threads

## Local development

From the repo root:

```bash
pnpm dev:server
pnpm dev:slack-bot
```

Or run both together:

```bash
ORCHESTORAI_SLACK_ENABLED=true pnpm dev:stack
```

The Slack bot reads configuration from environment variables or `slack-codex.config.json` in this package directory.

Important defaults for this monorepo:

- `CODEX_WORKDIR=../..` in `.env.example`
- `ORCHESTORAI_API_URL=http://127.0.0.1:3100`
- `SLACK_PORT=3000`

## Docker

The root `Dockerfile` now supports running OrchestorAI and this Slack bot in one image.

Build and run the combined stack with:

```bash
ORCHESTORAI_SLACK_ENABLED=true docker compose -f docker-compose.slack.yml up --build
```

Required environment variables for the Slack side:

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN` for socket mode
- `SLACK_SIGNING_SECRET` for HTTP mode
- `ORCHESTORAI_COMPANY_ID` if you want the OrchestorAI bridge enabled immediately

The image already includes the Codex CLI, but the Slack runtime still requires a valid Codex login. Because the container uses `HOME=/orchestorai`, you can either:

- persist `/orchestorai/.codex` in the mounted volume, or
- run `docker exec -it <container> codex login` once after startup

## Package commands

```bash
pnpm --filter @orchestorai/slack-bot start
pnpm --filter @orchestorai/slack-bot check
pnpm --filter @orchestorai/slack-bot test
```
