import { Command } from "commander";
import {
  createHostCommandFallbackSchema,
  type CreateHostCommandFallbackResult,
  type HostCommandAllowlistEntry,
  type HostCommandRequestDetail,
} from "@orchestorai/shared";
import {
  addCommonClientOptions,
  formatInlineRecord,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface HostCommandRequestOptions extends BaseClientOptions {
  companyId?: string;
  issueId: string;
  cwd: string;
  reason: string;
  missingCommand?: string;
  localErrorExcerpt?: string;
}

export function registerHostCommandCommands(program: Command): void {
  const hostCommand = program.command("host-command").description("Host command fallback operations");

  addCommonClientOptions(
    hostCommand
      .command("request")
      .description("Request a host command fallback execution")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .requiredOption("--issue-id <id>", "Linked issue ID")
      .requiredOption("--cwd <path>", "Absolute working directory on the host")
      .requiredOption("--reason <text>", "Reason for the fallback request")
      .option("--missing-command <name>", "Missing command that failed locally")
      .option("--local-error-excerpt <text>", "Excerpt of the local failure output")
      .argument("<binary>", "Host binary to execute")
      .argument("[args...]", "Host command arguments")
      .action(
        async (
          binary: string,
          args: string[],
          opts: HostCommandRequestOptions,
        ) => {
          try {
            const ctx = resolveCommandContext(opts, { requireCompany: true });
            const payload = createHostCommandFallbackSchema.parse({
              issueId: opts.issueId,
              binary,
              args,
              cwd: opts.cwd,
              reason: opts.reason,
              missingCommand: opts.missingCommand,
              localErrorExcerpt: opts.localErrorExcerpt,
            });
            const result = await ctx.api.post<CreateHostCommandFallbackResult>(
              `/api/companies/${ctx.companyId}/host-command-fallbacks`,
              payload,
            );
            printOutput(result, { json: ctx.json });
          } catch (err) {
            handleCommandError(err);
          }
        },
      ),
    { includeCompany: false },
  );

  addCommonClientOptions(
    hostCommand
      .command("get")
      .description("Get a host command fallback request")
      .argument("<requestId>", "Host command request ID")
      .action(async (requestId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.get<HostCommandRequestDetail>(
            `/api/host-command-fallbacks/${requestId}`,
          );
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const allowlist = hostCommand.command("allowlist").description("Manage host command allowlist entries");

  addCommonClientOptions(
    allowlist
      .command("list")
      .description("List host command allowlist entries")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: true });
          const rows = (await ctx.api.get<HostCommandAllowlistEntry[]>(
            `/api/companies/${ctx.companyId}/host-command-allowlist`,
          )) ?? [];

          if (ctx.json) {
            printOutput(rows, { json: true });
            return;
          }

          if (rows.length === 0) {
            printOutput([], { json: false });
            return;
          }

          for (const row of rows) {
            console.log(
              formatInlineRecord({
                id: row.id,
                projectId: row.projectId,
                binary: row.binary,
                revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  addCommonClientOptions(
    allowlist
      .command("revoke")
      .description("Revoke a host command allowlist entry")
      .argument("<entryId>", "Allowlist entry ID")
      .action(async (entryId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.delete<HostCommandAllowlistEntry>(
            `/api/host-command-allowlist/${entryId}`,
          );
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}
