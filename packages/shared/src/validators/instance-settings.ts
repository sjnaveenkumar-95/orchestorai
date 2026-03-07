import { z } from "zod";

const runtimeSecretValueSchema = z.string().trim().min(1).max(4096);

export const updateInstanceRuntimeSettingsSchema = z
  .object({
    slackBotToken: runtimeSecretValueSchema.optional(),
    slackAppToken: runtimeSecretValueSchema.optional(),
    betterAuthSecret: runtimeSecretValueSchema.optional(),
  })
  .refine(
    (value) =>
      Boolean(value.slackBotToken || value.slackAppToken || value.betterAuthSecret),
    {
      message: "Provide at least one runtime setting",
    },
  );

export type UpdateInstanceRuntimeSettings = z.infer<
  typeof updateInstanceRuntimeSettingsSchema
>;
