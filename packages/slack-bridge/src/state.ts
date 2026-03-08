import fs from "node:fs/promises";
import path from "node:path";

export interface ThreadLink {
  channelId: string;
  threadTs: string;
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

interface BridgeState {
  version: 1;
  threadLinks: Record<string, ThreadLink>;
}

function emptyState(): BridgeState {
  return { version: 1, threadLinks: {} };
}

function keyFor(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

export class FileStateStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async readState(): Promise<BridgeState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<BridgeState> | null;
      if (!parsed || parsed.version !== 1 || typeof parsed.threadLinks !== "object" || !parsed.threadLinks) {
        return emptyState();
      }
      return {
        version: 1,
        threadLinks: parsed.threadLinks as Record<string, ThreadLink>,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  private async writeState(state: BridgeState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async getThreadLink(channelId: string, threadTs: string): Promise<ThreadLink | null> {
    return this.serial(async () => {
      const state = await this.readState();
      return state.threadLinks[keyFor(channelId, threadTs)] ?? null;
    });
  }

  async getLatestLinkByIssue(issueRef: string): Promise<ThreadLink | null> {
    return this.serial(async () => {
      const state = await this.readState();
      const matches = Object.values(state.threadLinks).filter((link) => {
        return link.issueId === issueRef || link.issueIdentifier === issueRef;
      });
      matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return matches[0] ?? null;
    });
  }

  async upsertThreadLink(input: Omit<ThreadLink, "createdAt" | "updatedAt">): Promise<ThreadLink> {
    return this.serial(async () => {
      const state = await this.readState();
      const now = new Date().toISOString();
      const key = keyFor(input.channelId, input.threadTs);
      const existing = state.threadLinks[key];
      const next: ThreadLink = {
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      state.threadLinks[key] = next;
      await this.writeState(state);
      return next;
    });
  }
}
