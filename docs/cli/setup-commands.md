---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `orchestorai run`

One-command bootstrap and start:

```sh
pnpm orchestorai run
```

Does:

1. Auto-onboards if config is missing
2. Runs `orchestorai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm orchestorai run --instance dev
```

## `orchestorai onboard`

Interactive first-time setup:

```sh
pnpm orchestorai onboard
```

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm orchestorai onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm orchestorai onboard --yes
```

## `orchestorai doctor`

Health checks with optional auto-repair:

```sh
pnpm orchestorai doctor
pnpm orchestorai doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `orchestorai configure`

Update configuration sections:

```sh
pnpm orchestorai configure --section server
pnpm orchestorai configure --section secrets
pnpm orchestorai configure --section storage
```

## `orchestorai env`

Show resolved environment configuration:

```sh
pnpm orchestorai env
```

## `orchestorai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm orchestorai allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.orchestorai/instances/default/config.json` |
| Database | `~/.orchestorai/instances/default/db` |
| Logs | `~/.orchestorai/instances/default/logs` |
| Storage | `~/.orchestorai/instances/default/data/storage` |
| Secrets key | `~/.orchestorai/instances/default/secrets/master.key` |

Override with:

```sh
ORCHESTORAI_HOME=/custom/home ORCHESTORAI_INSTANCE_ID=dev pnpm orchestorai run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm orchestorai run --data-dir ./tmp/orchestorai-dev
pnpm orchestorai doctor --data-dir ./tmp/orchestorai-dev
```
