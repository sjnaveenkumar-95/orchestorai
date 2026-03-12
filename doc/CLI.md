# CLI Reference

OrchestorAI CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`)
- control-plane client operations (issues, approvals, host-command fallbacks, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm orchestorai --help
```

First-time local bootstrap + run:

```sh
pnpm orchestorai run
```

Choose local instance:

```sh
pnpm orchestorai run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `orchestorai onboard` and `orchestorai configure --section server` set deployment mode in config
- runtime can override mode with `ORCHESTORAI_DEPLOYMENT_MODE`
- `orchestorai run` and `orchestorai doctor` do not yet expose a direct `--mode` flag

Target behavior (planned) is documented in `doc/DEPLOYMENT-MODES.md` section 5.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm orchestorai allowed-hostname dotta-macbook-pro
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.orchestorai`:

```sh
pnpm orchestorai run --data-dir ./tmp/orchestorai-dev
pnpm orchestorai issue list --data-dir ./tmp/orchestorai-dev
```

## Context Profiles

Store local defaults in `~/.orchestorai/context.json`:

```sh
pnpm orchestorai context set --api-base http://localhost:3100 --company-id <company-id>
pnpm orchestorai context show
pnpm orchestorai context list
pnpm orchestorai context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm orchestorai context set --api-key-env-var-name ORCHESTORAI_API_KEY
export ORCHESTORAI_API_KEY=...
```

## Company Commands

```sh
pnpm orchestorai company list
pnpm orchestorai company get <company-id>
pnpm orchestorai company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm orchestorai company delete PAP --yes --confirm PAP
pnpm orchestorai company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- Deletion is server-gated by `ORCHESTORAI_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `ORCHESTORAI_COMPANY_ID`), not another company.

## Issue Commands

```sh
pnpm orchestorai issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm orchestorai issue get <issue-id-or-identifier>
pnpm orchestorai issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm orchestorai issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm orchestorai issue comment <issue-id> --body "..." [--reopen]
pnpm orchestorai issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm orchestorai issue release <issue-id>
```

## Agent Commands

```sh
pnpm orchestorai agent list --company-id <company-id>
pnpm orchestorai agent get <agent-id>
```

## Approval Commands

```sh
pnpm orchestorai approval list --company-id <company-id> [--status pending]
pnpm orchestorai approval get <approval-id>
pnpm orchestorai approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm orchestorai approval approve <approval-id> [--decision-note "..."] [--resolution-mode once|always]
pnpm orchestorai approval reject <approval-id> [--decision-note "..."]
pnpm orchestorai approval request-revision <approval-id> [--decision-note "..."]
pnpm orchestorai approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm orchestorai approval comment <approval-id> --body "..."
```

For `host_command_fallback` approvals:

- `--resolution-mode once` approves only the current host execution request
- `--resolution-mode always` also creates or refreshes the project-scoped binary allowlist entry

## Host Command Commands

```sh
pnpm orchestorai host-command request --company-id <company-id> --issue-id <issue-id> --cwd /absolute/path --reason "..." [--missing-command swift] [--local-error-excerpt "..."] <binary> [args...]
pnpm orchestorai host-command get <request-id>
pnpm orchestorai host-command allowlist list --company-id <company-id>
pnpm orchestorai host-command allowlist revoke <entry-id>
```

These commands are for explicit host fallback requests created by local agents after an exact missing-command failure.

## Activity Commands

```sh
pnpm orchestorai activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard Commands

```sh
pnpm orchestorai dashboard get --company-id <company-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm orchestorai heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Default local instance root is `~/.orchestorai/instances/default`:

- config: `~/.orchestorai/instances/default/config.json`
- embedded db: `~/.orchestorai/instances/default/db`
- logs: `~/.orchestorai/instances/default/logs`
- storage: `~/.orchestorai/instances/default/data/storage`
- secrets key: `~/.orchestorai/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
ORCHESTORAI_HOME=/custom/home ORCHESTORAI_INSTANCE_ID=dev pnpm orchestorai run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm orchestorai configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
