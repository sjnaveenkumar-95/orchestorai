import type { UIAdapterModule } from "../types";
import { parseOpenClawStdoutLine } from "@orchestorai/adapter-openclaw/ui";
import { buildOpenClawConfig } from "@orchestorai/adapter-openclaw/ui";
import { OpenClawConfigFields } from "./config-fields";

export const openClawUIAdapter: UIAdapterModule = {
  type: "openclaw",
  label: "OpenClaw",
  parseStdoutLine: parseOpenClawStdoutLine,
  ConfigFields: OpenClawConfigFields,
  buildAdapterConfig: buildOpenClawConfig,
};
