# slack-agent-dm

Reusable Slack DM runtime that accepts only 1:1 IM traffic.

Features:

- neutral `model` config surface
- no OrchestorAI imports or configuration
- DM-only routing
- optional pairing approval flow
- shared Slack native actions via `slack-agent-core`

Install it in another project with:

```sh
pnpm add slack-agent-dm
```

Then configure:

- `slack-agent.config.json` in your project root, or
- `SLACK_AGENT_CONFIG=/absolute/path/to/slack-agent.config.json`

Minimum environment:

```sh
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
MODEL_PROVIDER=codex_cli
MODEL_CODEX_THINKING=medium
MODEL_WORKDIR=/absolute/path/to/your/project
```

`MODEL_CODEX_THINKING` and `MODEL_CODEX_REASONING_EFFORT` accept `minimal`, `low`, `medium`, or `high` and are forwarded to Codex CLI as `model_reasoning_effort`.

Run it with:

```sh
pnpm exec slack-agent-dm
```

Pairing admin CLI:

```sh
pnpm exec slack-agent-dm-pairing list
pnpm exec slack-agent-dm-pairing approve 123456
```

Config defaults come from `slack-agent.config.json` or the `SLACK_AGENT_CONFIG` env var.
