# Slack Bridge

Minimal Slack <-> Paperclip bridge service.

What it does:

- creates Paperclip issues from Slack app mentions or `/paperclip`
- links a Slack thread to a Paperclip issue
- appends Slack thread messages to a linked Paperclip issue when the bot is mentioned
- exposes an outbound webhook so Paperclip or other tools can post back into Slack

This is intentionally small. It does not try to be a full Slack adapter inside the main Paperclip server.

## Environment

Copy `.env.example` and set:

- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `PAPERCLIP_API_URL`
- `PAPERCLIP_DEFAULT_COMPANY_ID` if you want Slack creates to default to one company
- `PAPERCLIP_API_TOKEN` only if your Paperclip instance requires bearer auth
- `SLACK_BRIDGE_OUTBOUND_TOKEN` if you want to protect the outbound webhook

## Run

```bash
pnpm --filter @paperclipai/slack-bridge dev
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

- Command: `/paperclip`
- Request URL: `https://<your-bridge-host>/slack/commands/paperclip`

Install the app to your workspace after scopes and routes are set.

## Commands

In Slack:

- `@paperclip help`
- `@paperclip create Fix login bug`
- `@paperclip create Fix login bug :: Users get a 500 after OAuth callback`
- `@paperclip create Fix login bug --company <company-id>`
- `@paperclip link PAP-42`
- `@paperclip status`
- `@paperclip comment Please prioritize this for today`

Behavior:

- root-channel mention with `create ...` creates a Paperclip issue and replies in a Slack thread
- mentioning the bot inside a linked thread adds a Paperclip comment
- `/paperclip some task title` creates a new issue and starts a channel thread

## Outbound Slack Posting

POST `http://127.0.0.1:3190/paperclip/outbound/message`

Headers:

- `Content-Type: application/json`
- `Authorization: Bearer <SLACK_BRIDGE_OUTBOUND_TOKEN>` if configured

Body:

```json
{
  "channelId": "C123456",
  "threadTs": "1741332412.123456",
  "text": "Paperclip update: issue moved to in_progress."
}
```

You can also resolve by linked issue:

```json
{
  "issueId": "PAP-42",
  "text": "Paperclip update: approval requested."
}
```

## Notes

- This bridge works best with Paperclip in `local_trusted` mode, or with a bearer token that has enough permission to create issues and add comments.
- Passive syncing of every thread reply is not implemented. To sync a comment, mention the bot in the thread.
