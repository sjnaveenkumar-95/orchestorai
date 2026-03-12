import type {
  CreateHostCommandFallback,
  CreateHostCommandFallbackResult,
  HostCommandAllowlistEntry,
  HostCommandRequestDetail,
} from "@orchestorai/shared";
import { api } from "./client";

export const hostCommandFallbacksApi = {
  create: (companyId: string, data: CreateHostCommandFallback) =>
    api.post<CreateHostCommandFallbackResult>(
      `/companies/${companyId}/host-command-fallbacks`,
      data,
    ),
  get: (id: string) =>
    api.get<HostCommandRequestDetail>(`/host-command-fallbacks/${id}`),
  listAllowlist: (companyId: string) =>
    api.get<HostCommandAllowlistEntry[]>(
      `/companies/${companyId}/host-command-allowlist`,
    ),
  revokeAllowlist: (entryId: string) =>
    api.delete<HostCommandAllowlistEntry>(`/host-command-allowlist/${entryId}`),
};
