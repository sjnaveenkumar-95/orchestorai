# Fresh Machine Setup

Use this when setting up OrchestorAI on a new machine for local development.

## 1. Install Prerequisites

- Node.js 20 or newer
- `pnpm` 9 or newer
- Git

Recommended `pnpm` setup:

```sh
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## 2. Clone and Install

```sh
git clone <repo-url>
cd OrchestorAI
pnpm install
```

## 3. Start the Simplest Local Setup

For the default local-dev path, do not set `DATABASE_URL`.

```sh
pnpm orchestorai run
```

This first-run path:

1. bootstraps local config if missing
2. runs doctor checks with repair enabled
3. starts the app

Expected local URL:

- `http://localhost:3100`

## 4. Verify It Works

In another terminal:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Expected results:

- `/api/health` returns `{"status":"ok"}`
- `/api/companies` returns a JSON array

## 5. Use the Normal Dev Loop

Once the machine is bootstrapped, use watch mode for day-to-day work:

```sh
pnpm dev
```

This runs the API in watch mode and serves the UI from the same origin.

## 6. Know the Default Local State

Without extra configuration, OrchestorAI stores local state under:

```text
~/.orchestorai/instances/default/
```

Important subpaths:

- `db/` embedded PostgreSQL data
- `data/storage/` local file storage
- `secrets/master.key` local secrets key
- `config.json` instance config

## 7. Important Rule for `.env`

Do not blindly copy `.env.example` for the default local-dev path.

`.env.example` sets:

```sh
DATABASE_URL=postgres://orchestorai:orchestorai@localhost:5432/orchestorai
```

That switches the app to external PostgreSQL instead of the embedded zero-config local database.

## 8. Optional Setup Variants

### Use External PostgreSQL

If you want a local Docker Postgres instead of embedded PostgreSQL:

```sh
cp .env.example .env
docker compose up -d
pnpm dev
```

### Use an Isolated Data Directory

Useful when you do not want state under `~/.orchestorai`:

```sh
pnpm orchestorai run --data-dir ./tmp/orchestorai-dev
```

### Reset Local Dev Data

If you want a clean local database:

```sh
rm -rf ~/.orchestorai/instances/default/db
pnpm dev
```

## 9. Optional API Keys

The app can start without model-provider API keys when using the default local setup.

You will need provider credentials when you start using adapters or flows that depend on them, for example:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

The company social-room speaker selector also uses the top-level OrchestorAI `llm` config from:

```text
~/.orchestorai/instances/default/config.json
```

Add or update the `llm` section in that file:

```json
"llm": { "provider": "openai", "model": "gpt-5.3-codex", "reasoningEffort": "medium" }
```

Notes:

- `provider: "openai"` now uses the local `codex` CLI for the social-room selector.
- `apiKey` is optional for that path. If omitted, the selector uses the local Codex login/session already available on the machine.
- `reasoningEffort` is optional and accepts `minimal`, `low`, `medium`, or `high`.
- If you prefer explicit API-key auth for Codex, you can still add `"apiKey": "sk-..."` or set `OPENAI_API_KEY`.

If the selector provider is missing or fails, social-room replies fall back to the built-in rotation logic.

Current social-room defaults:

- stale threads auto-close as `done` after 60 minutes of inactivity on the next scheduler pass
- follow-on chains debounce for 8 seconds and may wake up to 2 agents at a time
- explicit colleague mentions bias the next-speaker selector toward the mentioned agents
- agents can add Slack reactions to chat messages through the social-room API

## 10. Optional: Set Up Slack

The recommended local Slack path uses the integrated Slack runtime in socket mode.

### 10.1 Create and install a Slack app

Create a Slack app for your workspace, enable Socket Mode, and install the app to the workspace.

For the default socket-mode setup you will need:

- bot token: `SLACK_BOT_TOKEN` (`xoxb-...`)
- app token: `SLACK_APP_TOKEN` (`xapp-...`)

If you switch to `SLACK_MODE=http`, you will also need `SLACK_SIGNING_SECRET`.

### 10.2 Create the Slack runtime env file

```sh
cp packages/slack-channel-bot/.env.example packages/slack-channel-bot/.env
```

Then edit `packages/slack-channel-bot/.env` and set at least:

```sh
SLACK_MODE=socket
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-level-token
CODEX_THINKING=medium
```

Notes:

- `packages/slack-channel-bot/.env` owns Slack-specific settings and tokens
- `CODEX_THINKING` accepts `minimal`, `low`, `medium`, or `high`
- `pnpm dev:stack` reads `ORCHESTORAI_SLACK_ENABLED` from this env file

### 10.3 Create a company and capture its ID

Start OrchestorAI first:

```sh
pnpm dev
```

Create a company in the UI if needed, then get the company ID:

```sh
pnpm orchestorai company list
# or:
curl http://localhost:3100/api/companies
```

### 10.4 Configure the OrchestorAI bridge env

The Slack runtime reads OrchestorAI bridge settings from the OrchestorAI instance env:

```text
~/.orchestorai/instances/default/.env
```

Add:

```sh
ORCHESTORAI_ENABLED=true
ORCHESTORAI_API_URL=http://127.0.0.1:3100
ORCHESTORAI_COMPANY_ID=<your-company-id>
```

If you are using a non-default `ORCHESTORAI_HOME` or `ORCHESTORAI_INSTANCE_ID`, use that instance's `.env` path instead.

### 10.5 Start the Slack runtime

Use one of these flows:

Start OrchestorAI and the Slack bot together:

```sh
pnpm dev:stack
```

Or run them in separate terminals:

```sh
pnpm dev
pnpm dev:slack-bot
```

Useful variants:

- `pnpm dev:slack-channel` for channel/group usage only
- `pnpm dev:slack-bot` for the compatibility wrapper that keeps DM support enabled

## 11. Verify the Machine Is Ready for Contribution

Before calling the machine fully ready for development, run:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

## References

- `doc/DEVELOPING.md`
- `doc/DATABASE.md`
- `doc/CLI.md`
- `doc/DOCKER.md`
- `packages/slack-channel-bot/README.md`
- `packages/slack-bot/README.md`
