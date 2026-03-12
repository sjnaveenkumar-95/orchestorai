# slack-agent-core

Shared Slack agent runtime primitives:

- neutral config loading via `SLACK_AGENT_CONFIG` / `slack-agent.config.json`
- provider-neutral model adapter interface
- Codex CLI adapter implementation
- pairing store and pairing CLI helpers
- reusable Slack native actions and runtime utilities

This package is intentionally neutral and does not import any OrchestorAI modules.

It is meant to be published alongside `slack-agent-dm` and consumed as a normal npm dependency rather than through monorepo-relative imports.
