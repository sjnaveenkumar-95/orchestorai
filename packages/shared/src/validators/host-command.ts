import { z } from "zod";

export const createHostCommandFallbackSchema = z.object({
  issueId: z.string().uuid(),
  binary: z.string().trim().min(1).max(512),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().trim().min(1).max(2048),
  reason: z.string().trim().min(1).max(2048),
  missingCommand: z.string().trim().min(1).max(512).optional().nullable(),
  localErrorExcerpt: z.string().trim().min(1).max(8192).optional().nullable(),
});

export type CreateHostCommandFallback = z.infer<typeof createHostCommandFallbackSchema>;
