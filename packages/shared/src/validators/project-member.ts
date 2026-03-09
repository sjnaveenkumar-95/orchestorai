import { z } from "zod";

export const createProjectMemberSchema = z.object({
  agentId: z.string().uuid(),
});

export type CreateProjectMember = z.infer<typeof createProjectMemberSchema>;
