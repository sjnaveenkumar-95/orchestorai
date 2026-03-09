# Slack Bridge

Minimal Slack <-> OrchestorAI bridge service.

What it does:

- creates OrchestorAI issues from Slack app mentions or `/orchestorai`
- links a Slack thread to a OrchestorAI issue
- appends Slack thread messages to a linked OrchestorAI issue when the bot is mentioned
- exposes an outbound webhook so OrchestorAI or other tools can post back into Slack

This is intentionally small. It does not try to be a full Slack adapter inside the main OrchestorAI server.

## Environment

Copy `.env.example` and set:

- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `ORCHESTORAI_API_URL`
- `ORCHESTORAI_DEFAULT_COMPANY_ID` if you want Slack creates to default to one company
- `ORCHESTORAI_API_TOKEN` only if your OrchestorAI instance requires bearer auth
- `SLACK_BRIDGE_OUTBOUND_TOKEN` if you want to protect the outbound webhook

## Run

```bash
pnpm --filter @orchestorai/slack-bridge dev
```

Or from the repo root:

```bash
pnpm dev:slack-bridge
```

Default bridge URL: `http://127.0.0.1:3190`

## Slack App Setup

Create a Slack app and configure:

### OAuth scopes

- `app_mentions:read`
- `chat:write`
- `commands`

### Event subscriptions

- Enable Events
- Request URL: `https://<your-bridge-host>/slack/events`
- Subscribe to bot event: `app_mention`

### Slash command

- Command: `/orchestorai`
- Request URL: `https://<your-bridge-host>/slack/commands/orchestorai`

Install the app to your workspace after scopes and routes are set.

## Commands

In Slack:

- `@orchestorai help`
- `@orchestorai create Fix login bug`
- `@orchestorai create Fix login bug :: Users get a 500 after OAuth callback`
- `@orchestorai create Fix login bug --company <company-id>`
- `@orchestorai link PAP-42`
- `@orchestorai status`
- `@orchestorai comment Please prioritize this for today`

Behavior:

- root-channel mention with `create ...` creates a OrchestorAI issue and replies in a Slack thread
- mentioning the bot inside a linked thread adds a OrchestorAI comment
- `/orchestorai some task title` creates a new issue and starts a channel thread

## Outbound Slack Posting

POST `http://127.0.0.1:3190/orchestorai/outbound/message`

Headers:

- `Content-Type: application/json`
- `Authorization: Bearer <SLACK_BRIDGE_OUTBOUND_TOKEN>` if configured

Body:

```json
{
  "channelId": "C123456",
  "threadTs": "1741332412.123456",
  "text": "OrchestorAI update: issue moved to in_progress."
}
```

You can also resolve by linked issue:

```json
{
  "issueId": "PAP-42",
  "text": "OrchestorAI update: approval requested."
}
```

## Notes

- This bridge works best with OrchestorAI in `local_trusted` mode, or with a bearer token that has enough permission to create issues and add comments.
- Passive syncing of every thread reply is not implemented. To sync a comment, mention the bot in the thread.
