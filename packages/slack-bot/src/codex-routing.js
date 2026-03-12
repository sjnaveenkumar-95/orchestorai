import { createModelAdapter } from "slack-agent-core";

export function buildSlackBotDirectMessageModel(baseModel = {}, options = {}) {
  const directMessageSystemPrompt = String(options.directMessageSystemPrompt || "").trim();
  return {
    ...baseModel,
    systemPrompt: directMessageSystemPrompt || baseModel.systemPrompt,
    codexCli: {
      ...(baseModel.codexCli || {}),
      sandbox: "danger-full-access",
      bypassApprovalsAndSandbox: true,
    },
  };
}

export function buildSlackBotCodexAdapters(config, options = {}) {
  const defaultAdapter = options.modelAdapter || createModelAdapter(config.model);
  const directMessageAdapter =
    options.directMessageModelAdapter ||
    createModelAdapter(
      buildSlackBotDirectMessageModel(config.model, {
        directMessageSystemPrompt: options.directMessageSystemPrompt || config.codex?.directMessageSystemPrompt,
      }),
    );

  return {
    defaultAdapter,
    directMessageAdapter,
  };
}
