import { z } from "zod";

const runtimeSecretValueSchema = z.string().trim().min(1).max(4096);
const runtimeValueSchema = z.string().trim().min(1).max(2048);

export const updateInstanceRuntimeSettingsSchema = z
  .object({
    authPublicBaseUrl: z.string().trim().url().max(2048).optional(),
    slackDefaultChannelMemberIds: runtimeValueSchema.optional(),
    slackBoardApproverUserIds: runtimeValueSchema.optional(),
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
        value.slackBoardApproverUserIds ||
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
