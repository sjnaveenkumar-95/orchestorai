import type { CompanyChatRoom, UpdateCompanyChatRoom } from "@orchestorai/shared";
import { api } from "./client";

export const socialRoomApi = {
  getRoom: (companyId: string) =>
    api.get<CompanyChatRoom | null>(`/companies/${companyId}/chat-room`),
  provisionRoom: (companyId: string) =>
    api.post<CompanyChatRoom>(`/companies/${companyId}/chat-room/provision`, {}),
  updateRoom: (companyId: string, data: UpdateCompanyChatRoom) =>
    api.put<CompanyChatRoom>(`/companies/${companyId}/chat-room`, data),
};
