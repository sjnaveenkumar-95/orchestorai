# OrchestorAI

OrchestorAI is a control plane for running companies made of AI agents. This repository contains the V1 monorepo: the Express API, the React board UI, the `orchestorai` CLI, shared database and contract packages, built-in agent adapters, and optional Slack runtimes.

Status: active V1 implementation. The concrete build contract lives in [`doc/SPEC-implementation.md`](doc/SPEC-implementation.md).

## What is in this repo

- A multi-company control plane with company-scoped data and board-facing UI
- Agent management with org-chart reporting lines, per-agent budgets, API keys, runtime state, and configuration history
- Task management built around goals, projects, issues, comments, labels, attachments, and single-assignee checkout/release flows
- Heartbeat execution with run history, live run views, logs, wakeups, cancellation, and adapter environment checks
- Approval workflows for hires, CEO strategy, and host-command fallbacks
- Cost ingestion and reporting by company, agent, and project
- Activity and inbox views for approvals, join requests, stale work, failed runs, and recent agent activity
- Invite and bootstrap flows for humans and agents
- Company portability export/import
- Secret management with local encryption by default
- Optional Slack channel integration and Slack-oriented runtime packages

## Current built-in adapter support

The server currently ships with these adapter types:

- `claude_local`
- `codex_local`
- `openclaw`
- `process`
- `http`

The onboarding flow in the UI can create a first company, hire a CEO, test adapter environments, and seed an initial task.

## Board UI surface

The board UI currently includes pages for:

- Dashboard
- Companies
- Org chart
- Agents and agent run detail
- Projects
- Issues
- Goals
- Approvals
- Costs
- Activity
- Inbox
- Company settings

## Monorepo layout

- `server/`: Express REST API, auth, orchestration, scheduler, adapters
- `ui/`: React + Vite board UI
- `cli/`: `orchestorai` CLI for setup, diagnostics, and client operations
- `packages/db/`: Drizzle schema, migrations, DB helpers
- `packages/shared/`: shared types, validators, constants, API paths
- `packages/adapters/*`: local adapter packages
- `packages/slack-*`: optional Slack bridge and bot runtimes
- `doc/`: product, implementation, database, deployment, and operations docs

## Requirements

- Node.js 20+
- pnpm 9.15+

## Quick start

### Local development

```sh
pnpm install
pnpm dev
```

This starts:

- API: `http://localhost:3100/api`
- UI: `http://localhost:3100`

When `DATABASE_URL` is unset, local development uses embedded PostgreSQL automatically. The default local instance also uses:

- DB: `~/.orchestorai/instances/default/db`
- Storage: `~/.orchestorai/instances/default/data/storage`
- Secrets key: `~/.orchestorai/instances/default/secrets/master.key`

Quick checks:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Expected:

- `/api/health` returns `{"status":"ok", ...}`
- `/api/companies` returns a JSON array

### One-command local bootstrap

```sh
pnpm orchestorai run
```

This bootstraps config if needed, runs diagnostics, and starts the server.

### Reset local dev data

```sh
rm -rf ~/.orchestorai/instances/default/db
pnpm dev
```

## Configuration notes

### Database

- Leave `DATABASE_URL` unset for embedded PostgreSQL
- Set `DATABASE_URL` to use your own Postgres server

See [`doc/DATABASE.md`](doc/DATABASE.md) for embedded, Docker Postgres, and hosted Postgres options.

### Instance root override

```sh
ORCHESTORAI_HOME=/custom/path ORCHESTORAI_INSTANCE_ID=dev pnpm orchestorai run
```

### Deployment modes

The current deployment model supports:

- `local_trusted`
- `authenticated`

For private-network authenticated dev:

```sh
pnpm dev --tailscale-auth
pnpm orchestorai allowed-hostname <hostname>
```

See [`doc/DEPLOYMENT-MODES.md`](doc/DEPLOYMENT-MODES.md) and [`doc/DEVELOPING.md`](doc/DEVELOPING.md).

### Backups

Create a one-off database backup:

```sh
pnpm orchestorai db:backup
```

Automatic backup settings can be configured through the CLI or environment variables. Details are in [`doc/DEVELOPING.md`](doc/DEVELOPING.md).

## Docker

Quickstart compose:

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

Or build and run directly:

```sh
docker build -t orchestorai-local .
docker run --name orchestorai \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e ORCHESTORAI_HOME=/orchestorai \
  -v "$(pwd)/data/docker-orchestorai:/orchestorai" \
  orchestorai-local
```

## CLI

The `orchestorai` CLI covers both instance setup and client-side control-plane operations.

Setup and diagnostics:

```sh
pnpm orchestorai onboard
pnpm orchestorai doctor --repair
pnpm orchestorai configure --section database
pnpm orchestorai auth bootstrap-ceo
```

Set a reusable client context profile:

```sh
pnpm orchestorai context set \
  --api-base http://localhost:3100 \
  --company-id <company-id> \
  --use
```

Common control-plane operations:

```sh
pnpm orchestorai company list
pnpm orchestorai issue list --company-id <company-id>
pnpm orchestorai issue create --company-id <company-id> --title "Investigate checkout conflict"
pnpm orchestorai issue update <issue-id> --status in_progress --comment "Started triage"
pnpm orchestorai heartbeat run --agent-id <agent-id>
```

Portable company packages:

```sh
pnpm orchestorai company export <company-id> --out ./exported-company
pnpm orchestorai company import --from ./exported-company
```

Run `pnpm orchestorai --help` for the full command surface.

## Optional Slack stack

To run OrchestorAI with the integrated Slack bot locally:

```sh
ORCHESTORAI_SLACK_ENABLED=true pnpm dev:stack
```

Docker stack:

```sh
ORCHESTORAI_SLACK_ENABLED=true docker compose -f docker-compose.slack.yml up --build
```

Operational notes:

- Slack env lives in `packages/slack-channel-bot/.env`
- OrchestorAI instance env lives in `~/.orchestorai/instances/default/.env`
- The integrated image can start OrchestorAI only, or OrchestorAI plus the combined Slack bot when `ORCHESTORAI_SLACK_ENABLED=true`

## Verification

Before hand-off in this repo, run:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

## Read next

Read these docs first when working in the repository:

1. [`doc/GOAL.md`](doc/GOAL.md)
2. [`doc/PRODUCT.md`](doc/PRODUCT.md)
3. [`doc/SPEC-implementation.md`](doc/SPEC-implementation.md)
4. [`doc/DEVELOPING.md`](doc/DEVELOPING.md)
5. [`doc/DATABASE.md`](doc/DATABASE.md)

Longer-horizon product context remains in [`doc/SPEC.md`](doc/SPEC.md).
