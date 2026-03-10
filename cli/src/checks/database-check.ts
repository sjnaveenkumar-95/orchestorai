import fs from "node:fs";
import type { OrchestorAIConfig } from "../config/schema.js";
import type { CheckResult } from "./index.js";
import { resolveRuntimeLikePath } from "./path-resolver.js";

export async function databaseCheck(config: OrchestorAIConfig, configPath?: string): Promise<CheckResult> {
  const envConnectionString = process.env.DATABASE_URL?.trim() || undefined;
  const configConnectionString =
    config.database.mode === "postgres" ? config.database.connectionString?.trim() || undefined : undefined;
  const connectionString = envConnectionString ?? configConnectionString;

  if (connectionString) {
    const connectionSource = envConnectionString ? "DATABASE_URL" : "config";

    try {
      const { createDb } = await import("@orchestorai/db");
      const db = createDb(connectionString);
      await db.execute("SELECT 1");
      return {
        name: "Database",
        status: "pass",
        message: `PostgreSQL connection successful via ${connectionSource}`,
      };
    } catch (err) {
      return {
        name: "Database",
        status: "fail",
        message: `Cannot connect to PostgreSQL via ${connectionSource}: ${err instanceof Error ? err.message : String(err)}`,
        canRepair: false,
        repairHint: "Check your connection string and ensure PostgreSQL is running",
      };
    }
  }

  if (config.database.mode === "postgres") {
    return {
      name: "Database",
      status: "fail",
      message: "PostgreSQL mode selected but no connection string configured",
      canRepair: false,
      repairHint: "Run `orchestorai configure --section database`",
    };
  }

  if (config.database.mode === "embedded-postgres") {
    const dataDir = resolveRuntimeLikePath(config.database.embeddedPostgresDataDir, configPath);
    const reportedPath = dataDir;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(reportedPath, { recursive: true });
    }

    return {
      name: "Database",
      status: "pass",
      message: `Embedded PostgreSQL configured at ${dataDir} (port ${config.database.embeddedPostgresPort})`,
    };
  }

  return {
    name: "Database",
    status: "fail",
    message: `Unknown database mode: ${String(config.database.mode)}`,
    canRepair: false,
    repairHint: "Run `orchestorai configure --section database`",
  };
}
