import type { SidebarBadges } from "@paperclipai/shared";
import { api } from "./client";

export const sidebarBadgesApi = {
  get: (companyId: string, dismissedIds: string[] = []) => {
    const params = new URLSearchParams();
    for (const id of dismissedIds) {
      if (id) params.append("dismissed", id);
    }
    const suffix = params.toString();
    return api.get<SidebarBadges>(
      `/companies/${companyId}/sidebar-badges${suffix ? `?${suffix}` : ""}`,
    );
  },
};
