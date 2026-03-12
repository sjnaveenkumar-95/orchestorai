# Developing

This project can run fully in local dev without setting up PostgreSQL manually.

## Deployment Modes

For mode definitions and intended CLI behavior, see `doc/DEPLOYMENT-MODES.md`.

Current implementation status:

- canonical model: `local_trusted` and `authenticated` (with `private/public` exposure)

## Production Service Wrapper

Use the production wrapper script when you want one command for a specific long-running service:

```sh
bash scripts/start-production-service.sh backend
bash scripts/start-production-service.sh frontend
bash scripts/start-production-service.sh slack-bot
bash scripts/start-production-service.sh slack-dm
bash scripts/start-production-service.sh stack
```

Use the multi-terminal launcher when you want backend, frontend, and the combined OrchestorAI Slack bot started together in separate macOS Terminal sessions:

```sh
bash scripts/start-production-terminals.sh
pnpm run start:prod:terminals
```

This launcher builds once up front, then starts each service with `ORCHESTORAI_SKIP_BUILD=true`. Terminal may open new windows or new tabs depending on your local Terminal preferences.

## Prerequisites

- Node.js 20+
- pnpm 9+

## Start Dev

From repo root:

```sh
pnpm install
pnpm dev
```

This starts:

- API server: `http://localhost:3100`
- UI: served by the API server in dev middleware mode (same origin as API)

`pnpm dev` runs the server in watch mode and restarts on changes from workspace packages (including adapter packages). Use `pnpm dev:once` to run without file watching.

Tailscale/private-auth dev mode:

```sh
pnpm dev --tailscale-auth
```

This runs dev as `authenticated/private` and binds the server to `0.0.0.0` for private-network access.

Allow additional private hostnames (for example custom Tailscale hostnames):

```sh
pnpm orchestorai allowed-hostname dotta-macbook-pro
```

## One-Command Local Run

For a first-time local install, you can bootstrap and run in one command:

```sh
pnpm orchestorai run
```

`orchestorai run` does:

1. auto-onboard if config is missing
2. `orchestorai doctor` with repair enabled
3. starts the server when checks pass

## Docker Quickstart (No local Node install)

Build and run OrchestorAI in Docker:

```sh
docker build -t orchestorai-local .
docker run --name orchestorai \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e ORCHESTORAI_HOME=/orchestorai \
  -v "$(pwd)/data/docker-orchestorai:/orchestorai" \
  orchestorai-local
```

Or use Compose:

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

See `doc/DOCKER.md` for API key wiring (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) and persistence details.

## Database in Dev (Auto-Handled)

For local development, leave `DATABASE_URL` unset.
The server will automatically use embedded PostgreSQL and persist data at:

- `~/.orchestorai/instances/default/db`

Override home and instance:

```sh
ORCHESTORAI_HOME=/custom/path ORCHESTORAI_INSTANCE_ID=dev pnpm orchestorai run
```

No Docker or external database is required for this mode.

## Storage in Dev (Auto-Handled)

For local development, the default storage provider is `local_disk`, which persists uploaded images/attachments at:

- `~/.orchestorai/instances/default/data/storage`

Configure storage provider/settings:

```sh
pnpm orchestorai configure --section storage
```

## Default Agent Workspaces

When a local agent run has no resolved project/session workspace, OrchestorAI falls back to an agent home workspace under the instance root:

- `~/.orchestorai/instances/default/workspaces/<agent-id>`

This path honors `ORCHESTORAI_HOME` and `ORCHESTORAI_INSTANCE_ID` in non-default setups.

## Quick Health Checks

In another terminal:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Expected:

- `/api/health` returns `{"status":"ok"}`
- `/api/companies` returns a JSON array

## Slack Env Separation

For the integrated Slack runtime, keep Slack-specific env in:

- `packages/slack-channel-bot/.env`

Keep OrchestorAI instance env in the home instance path:

- `~/.orchestorai/instances/default/.env`

The Slack runtime reads Slack auth/settings from its package env and reads OrchestorAI bridge values from the OrchestorAI home env by default.

For Codex reasoning effort in Slack, set `CODEX_THINKING` in `packages/slack-channel-bot/.env` with one of `minimal`, `low`, `medium`, or `high`.

## Reset Local Dev Database

To wipe local dev data and start fresh:

```sh
rm -rf ~/.orchestorai/instances/default/db
pnpm dev
```

## Optional: Use External Postgres

If you set `DATABASE_URL`, the server will use that instead of embedded PostgreSQL.

## Automatic DB Backups

OrchestorAI can run automatic DB backups on a timer. Defaults:

- enabled
- every 60 minutes
- retain 30 days
- backup dir: `~/.orchestorai/instances/default/data/backups`

Configure these in:

```sh
pnpm orchestorai configure --section database
```

Run a one-off backup manually:

```sh
pnpm orchestorai db:backup
# or:
pnpm db:backup
```

Environment overrides:

- `ORCHESTORAI_DB_BACKUP_ENABLED=true|false`
- `ORCHESTORAI_DB_BACKUP_INTERVAL_MINUTES=<minutes>`
- `ORCHESTORAI_DB_BACKUP_RETENTION_DAYS=<days>`
- `ORCHESTORAI_DB_BACKUP_DIR=/absolute/or/~/path`

## Secrets in Dev

Agent env vars now support secret references. By default, secret values are stored with local encryption and only secret refs are persisted in agent config.

- Default local key path: `~/.orchestorai/instances/default/secrets/master.key`
- Override key material directly: `ORCHESTORAI_SECRETS_MASTER_KEY`
- Override key file path: `ORCHESTORAI_SECRETS_MASTER_KEY_FILE`

Strict mode (recommended outside local trusted machines):

```sh
ORCHESTORAI_SECRETS_STRICT_MODE=true
```

When strict mode is enabled, sensitive env keys (for example `*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values.

CLI configuration support:

- `pnpm orchestorai onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm orchestorai configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm orchestorai doctor` validates secrets adapter configuration and can create a missing local key file with `--repair`.

Migration helper for existing inline env secrets:

```sh
pnpm secrets:migrate-inline-env         # dry run
pnpm secrets:migrate-inline-env --apply # apply migration
```

## Company Deletion Toggle

Company deletion is intended as a dev/debug capability and can be disabled at runtime:

```sh
ORCHESTORAI_ENABLE_COMPANY_DELETION=false
```

Default behavior:

- `local_trusted`: enabled
- `authenticated`: disabled

## CLI Client Operations

OrchestorAI CLI now includes client-side control-plane commands in addition to setup commands.

Quick examples:

```sh
pnpm orchestorai issue list --company-id <company-id>
pnpm orchestorai issue create --company-id <company-id> --title "Investigate checkout conflict"
pnpm orchestorai issue update <issue-id> --status in_progress --comment "Started triage"
```

Set defaults once with context profiles:

```sh
pnpm orchestorai context set --api-base http://localhost:3100 --company-id <company-id>
```

Then run commands without repeating flags:

```sh
pnpm orchestorai issue list
pnpm orchestorai dashboard get
```

See full command reference in `doc/CLI.md`.

## OpenClaw Invite Onboarding Endpoints

Agent-oriented invite onboarding now exposes machine-readable API docs:

- `GET /api/invites/:token` returns invite summary plus onboarding and skills index links.
- `GET /api/invites/:token/onboarding` returns onboarding manifest details (registration endpoint, claim endpoint template, skill install hints).
- `GET /api/invites/:token/onboarding.txt` returns a plain-text onboarding doc intended for both human operators and agents (llm.txt-style handoff), including optional inviter message and suggested network host candidates.
- `GET /api/skills/index` lists available skill documents.
- `GET /api/skills/orchestorai` returns the OrchestorAI heartbeat skill markdown.

## OpenClaw Join Smoke Test

Run the end-to-end OpenClaw join smoke harness:

```sh
pnpm smoke:openclaw-join
```

What it validates:

- invite creation for agent-only join
- agent join request using `adapterType=openclaw`
- board approval + one-time API key claim semantics
- callback delivery on wakeup to a dockerized OpenClaw-style webhook receiver

Required permissions:

- This script performs board-governed actions (create invite, approve join, wakeup another agent).
- In authenticated mode, run with board auth via `ORCHESTORAI_AUTH_HEADER` or `ORCHESTORAI_COOKIE`.

Optional auth flags (for authenticated mode):

- `ORCHESTORAI_AUTH_HEADER` (for example `Bearer ...`)
- `ORCHESTORAI_COOKIE` (session cookie header value)

## OpenClaw Docker UI One-Command Script

To boot OpenClaw in Docker and print a host-browser dashboard URL in one command:

```sh
pnpm smoke:openclaw-docker-ui
```

This script lives at `scripts/smoke/openclaw-docker-ui.sh` and automates clone/build/config/start for Compose-based local OpenClaw UI testing.

Pairing behavior for this smoke script:

- default `OPENCLAW_DISABLE_DEVICE_AUTH=1` (no Control UI pairing prompt for local smoke; no extra pairing env vars required)
- set `OPENCLAW_DISABLE_DEVICE_AUTH=0` to require standard device pairing

Model behavior for this smoke script:

- defaults to OpenAI models (`openai/gpt-5.2` + OpenAI fallback) so it does not require Anthropic auth by default

State behavior for this smoke script:

- defaults to isolated config dir `~/.openclaw-orchestorai-smoke`
- resets smoke agent state each run by default (`OPENCLAW_RESET_STATE=1`) to avoid stale provider/auth drift

Networking behavior for this smoke script:

- auto-detects and prints a OrchestorAI host URL reachable from inside OpenClaw Docker
- default container-side host alias is `host.docker.internal` (override with `ORCHESTORAI_HOST_FROM_CONTAINER` / `ORCHESTORAI_HOST_PORT`)
- if OrchestorAI rejects container hostnames in authenticated/private mode, allow `host.docker.internal` via `pnpm orchestorai allowed-hostname host.docker.internal` and restart OrchestorAI
