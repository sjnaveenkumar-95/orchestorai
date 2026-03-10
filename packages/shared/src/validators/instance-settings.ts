import { z } from "zod";

const runtimeSecretValueSchema = z.string().trim().min(1).max(4096);
const runtimeValueSchema = z.string().trim().min(1).max(2048);

export const updateInstanceRuntimeSettingsSchema = z
  .object({
    authPublicBaseUrl: z.string().trim().url().max(2048).optional(),
    slackDefaultChannelMemberIds: runtimeValueSchema.optional(),
    slackInterpreterEnabled: z.boolean().optional(),
    slackInterpreterModel: runtimeValueSchema.optional(),
    slackInterpreterProfile: runtimeValueSchema.optional(),
    slackInterpreterWorkdir: runtimeValueSchema.optional(),
    slackInterpreterTimeoutSec: z.number().int().positive().max(86400).optional(),
    slackInterpreterContextLimit: z.number().int().positive().max(200).optional(),
    slackAgentMappingsJson: runtimeValueSchema.optional(),
    slackProjectMappingsJson: runtimeValueSchema.optional(),
    slackBotToken: runtimeSecretValueSchema.optional(),
    slackAppToken: runtimeSecretValueSchema.optional(),
    slackManifestToken: runtimeSecretValueSchema.optional(),
    slackSigningSecret: runtimeSecretValueSchema.optional(),
    betterAuthSecret: runtimeSecretValueSchema.optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.authPublicBaseUrl ||
        value.slackDefaultChannelMemberIds ||
        value.slackInterpreterEnabled !== undefined ||
        value.slackInterpreterModel ||
        value.slackInterpreterProfile ||
        value.slackInterpreterWorkdir ||
        value.slackInterpreterTimeoutSec !== undefined ||
        value.slackInterpreterContextLimit !== undefined ||
        value.slackAgentMappingsJson ||
        value.slackProjectMappingsJson ||
        value.slackBotToken ||
        value.slackAppToken ||
        value.slackManifestToken ||
        value.slackSigningSecret ||
        value.betterAuthSecret,
      ),
    {
      message: "Provide at least one runtime setting",
    },
  );

export type UpdateInstanceRuntimeSettings = z.infer<
  typeof updateInstanceRuntimeSettingsSchema
>;
