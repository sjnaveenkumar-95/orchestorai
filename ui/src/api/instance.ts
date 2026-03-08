import type {
  InstanceRuntimeSettings,
  UpdateInstanceRuntimeSettings
} from "@paperclipai/shared";
import { api } from "./client";

export const instanceApi = {
  getRuntimeSettings: () =>
    api.get<InstanceRuntimeSettings>("/instance/runtime-settings"),
  updateRuntimeSettings: (data: UpdateInstanceRuntimeSettings) =>
    api.patch<InstanceRuntimeSettings>("/instance/runtime-settings", data)
};
