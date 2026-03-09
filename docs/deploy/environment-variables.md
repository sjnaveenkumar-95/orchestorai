---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that OrchestorAI uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `HOST` | `127.0.0.1` | Server host binding |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `ORCHESTORAI_HOME` | `~/.orchestorai` | Base directory for all OrchestorAI data |
| `ORCHESTORAI_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `ORCHESTORAI_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTORAI_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `ORCHESTORAI_SECRETS_MASTER_KEY_FILE` | `~/.orchestorai/.../secrets/master.key` | Path to key file |
| `ORCHESTORAI_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `ORCHESTORAI_AGENT_ID` | Agent's unique ID |
| `ORCHESTORAI_COMPANY_ID` | Company ID |
| `ORCHESTORAI_API_URL` | OrchestorAI API base URL |
| `ORCHESTORAI_API_KEY` | Short-lived JWT for API auth |
| `ORCHESTORAI_RUN_ID` | Current heartbeat run ID |
| `ORCHESTORAI_TASK_ID` | Issue that triggered this wake |
| `ORCHESTORAI_WAKE_REASON` | Wake trigger reason |
| `ORCHESTORAI_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `ORCHESTORAI_APPROVAL_ID` | Resolved approval ID |
| `ORCHESTORAI_APPROVAL_STATUS` | Approval decision |
| `ORCHESTORAI_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
