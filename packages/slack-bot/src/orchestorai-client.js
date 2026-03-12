import { createHmac } from "node:crypto";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function readResponseBody(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  const text = await response.text();
  return text ? { message: text } : {};
}

async function toMessageData(raw) {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw.text === "function") {
    return await raw.text();
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  return String(raw || "");
}

export class OrchestorAIClient {
  constructor(params) {
    this.apiUrl = trimTrailingSlash(params.apiUrl);
    this.companyId = String(params.companyId || "").trim();
    this.controlSigningSecret = String(params.controlSigningSecret || "").trim();
    this.fetchImpl = params.fetchImpl || globalThis.fetch;
    this.WebSocketImpl = params.WebSocketImpl || globalThis.WebSocket;
    this.log = typeof params.log === "function" ? params.log : () => {};
    this.agentCache = {
      expiresAt: 0,
      value: [],
    };
    this.agentWithSlackCache = {
      expiresAt: 0,
      value: [],
    };
    this.agentSlackAppCache = new Map();
    this.projectCache = {
      expiresAt: 0,
      value: [],
    };
    this.issueCache = {
      expiresAt: 0,
      key: "",
      value: [],
    };
  }

  buildUrl(pathname) {
    return `${this.apiUrl}${pathname}`;
  }
  buildSignedSlackHeaders(rawBody) {
    if (!this.controlSigningSecret) {
      throw new Error("control signing secret is not configured");
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const base = `v0:${timestamp}:${rawBody}`;
    const signature = `v0=${createHmac("sha256", this.controlSigningSecret).update(base).digest("hex")}`;
    return {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    };
  }
  async requestJson(method, pathname, body, options = {}) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch is not available in this runtime");
    }

    const rawBody = body ? JSON.stringify(body) : undefined;
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
      ...(rawBody ? { "Content-Type": "application/json" } : {}),
      ...(options.signed && rawBody ? this.buildSignedSlackHeaders(rawBody) : {}),
    };

    const response = await this.fetchImpl(this.buildUrl(pathname), {
      method,
      headers,
      ...(rawBody ? { body: rawBody } : {}),
    });

    if (!response.ok) {
      const errorBody = await readResponseBody(response);
      const detail =
        typeof errorBody?.error === "string"
          ? errorBody.error
          : typeof errorBody?.message === "string"
            ? errorBody.message
            : JSON.stringify(errorBody);
      throw new Error(`${method} ${pathname} failed (${response.status}): ${detail}`);
    }

    return await readResponseBody(response);
  }

  async handleSlackApprovalThreadReply(body) {
    return await this.requestJson(
      "POST",
      "/api/slack/control/approval-thread-replies",
      body,
      { signed: true },
    );
  }

  async listAgents(options = {}) {
    const force = Boolean(options.force);
    const includeSlack = Boolean(options.includeSlack);
    const now = Date.now();
    if (includeSlack && !force && this.agentWithSlackCache.expiresAt > now) {
      return this.agentWithSlackCache.value;
    }
    if (!force && this.agentCache.expiresAt > now) {
      return includeSlack ? await this.attachSlackAgentData(this.agentCache.value, { force }) : this.agentCache.value;
    }
    const agents = await this.requestJson("GET", `/api/companies/${this.companyId}/agents`);
    this.agentCache = {
      expiresAt: now + 60 * 1000,
      value: Array.isArray(agents) ? agents : [],
    };
    if (!includeSlack) {
      return this.agentCache.value;
    }
    return await this.attachSlackAgentData(this.agentCache.value, { force });
  }

  async getAgentSlackApp(agentId, options = {}) {
    const id = String(agentId || "").trim();
    if (!id) {
      return null;
    }
    const force = Boolean(options.force);
    const cached = this.agentSlackAppCache.get(id);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const slackApp = await this.requestJson("GET", `/api/agents/${id}/slack`);
    const value = slackApp && typeof slackApp === "object" ? slackApp : null;
    this.agentSlackAppCache.set(id, {
      expiresAt: Date.now() + 60 * 1000,
      value,
    });
    return value;
  }

  async attachSlackAgentData(agents, options = {}) {
    const force = Boolean(options.force);
    const source = Array.isArray(agents) ? agents : [];
    const enriched = await Promise.all(
      source.map(async (agent) => {
        const agentId = String(agent?.id || "").trim();
        if (!agentId) {
          return agent;
        }
        try {
          const slackApp = await this.getAgentSlackApp(agentId, { force });
          const botUserId = String(slackApp?.botUserId || "").trim();
          if (!botUserId) {
            return agent;
          }
          return {
            ...agent,
            slackBotUserId: botUserId,
          };
        } catch (error) {
          this.log(
            "warn",
            `Failed to load Slack app metadata for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return agent;
        }
      }),
    );
    this.agentWithSlackCache = {
      expiresAt: Date.now() + 60 * 1000,
      value: enriched,
    };
    return enriched;
  }

  async getAgentName(agentId) {
    if (!agentId) {
      return "";
    }
    const agents = await this.listAgents();
    const matched = agents.find((agent) => String(agent?.id || "") === String(agentId));
    return String(matched?.name || "");
  }

  async listProjects(options = {}) {
    const force = Boolean(options.force);
    if (!force && this.projectCache.expiresAt > Date.now()) {
      return this.projectCache.value;
    }
    const projects = await this.requestJson("GET", `/api/companies/${this.companyId}/projects`);
    this.projectCache = {
      expiresAt: Date.now() + 60 * 1000,
      value: Array.isArray(projects) ? projects : [],
    };
    return this.projectCache.value;
  }

  async getManagedProjectChannel(channelId, options = {}) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) {
      return null;
    }

    const projects = await this.listProjects(options);
    return (
      projects.find((project) => {
        const slackChannel = project?.slackChannel;
        return (
          String(slackChannel?.channelId || "").trim() === normalizedChannelId &&
          String(slackChannel?.status || "").trim().toLowerCase() === "active"
        );
      }) || null
    );
  }

  buildIssueQuery(options = {}) {
    const params = new URLSearchParams();
    for (const key of ["status", "assigneeAgentId", "projectId", "q"]) {
      const value = String(options[key] || "").trim();
      if (value) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  invalidateIssueCache() {
    this.issueCache = {
      expiresAt: 0,
      key: "",
      value: [],
    };
  }

  async listIssues(options = {}) {
    const force = Boolean(options.force);
    const query = this.buildIssueQuery(options);
    if (!force && this.issueCache.expiresAt > Date.now() && this.issueCache.key === query) {
      return this.issueCache.value;
    }
    const issues = await this.requestJson("GET", `/api/companies/${this.companyId}/issues${query}`);
    this.issueCache = {
      expiresAt: Date.now() + 15 * 1000,
      key: query,
      value: Array.isArray(issues) ? issues : [],
    };
    return this.issueCache.value;
  }

  async getIssue(issueId) {
    if (!issueId) {
      throw new Error("issueId is required");
    }
    return await this.requestJson("GET", `/api/issues/${issueId}`);
  }

  async listIssueComments(issueId) {
    if (!issueId) {
      throw new Error("issueId is required");
    }
    const comments = await this.requestJson("GET", `/api/issues/${issueId}/comments`);
    return Array.isArray(comments) ? comments : [];
  }

  async createIssue(body) {
    const issue = await this.requestJson("POST", `/api/companies/${this.companyId}/issues`, body);
    this.invalidateIssueCache();
    return issue;
  }

  async addIssueComment(issueId, body) {
    const comment = await this.requestJson("POST", `/api/issues/${issueId}/comments`, {
      body,
    });
    this.invalidateIssueCache();
    return comment;
  }

  async getRunIssues(runId) {
    const issues = await this.requestJson("GET", `/api/heartbeat-runs/${runId}/issues`);
    return Array.isArray(issues) ? issues : [];
  }

  async forwardSlackControlEvent(payload, options = {}) {
    const botToken = String(options.botToken || "").trim();
    if (!botToken) {
      throw new Error("botToken is required to forward Slack control events");
    }

    return await this.requestJson("POST", "/api/slack/control/events", payload, {
      headers: {
        authorization: `Bearer ${botToken}`,
        "x-orchestorai-slack-source": "slack-bot",
      },
    });
  }

  subscribeLiveEvents(handlers = {}) {
    if (typeof this.WebSocketImpl !== "function") {
      throw new Error("WebSocket is not available in this runtime");
    }

    let stopped = false;
    let socket = null;
    let reconnectTimer = null;
    let reconnectDelayMs = 1000;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped) {
        return;
      }
      clearReconnect();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
    };

    const connect = () => {
      clearReconnect();
      const wsUrl = this.buildUrl(`/api/companies/${this.companyId}/events/ws`).replace(/^http/i, "ws");
      socket = new this.WebSocketImpl(wsUrl);

      socket.addEventListener("open", () => {
        reconnectDelayMs = 1000;
        if (typeof handlers.onOpen === "function") {
          handlers.onOpen();
        }
      });

      socket.addEventListener("message", async (event) => {
        try {
          const data = await toMessageData(event.data);
          const parsed = JSON.parse(data);
          if (typeof handlers.onEvent === "function") {
            await handlers.onEvent(parsed);
          }
        } catch (err) {
          this.log("warn", `orchestorai live event parse failed: ${String(err)}`);
        }
      });

      socket.addEventListener("error", (event) => {
        const message = event?.message || event?.error?.message || "orchestorai websocket error";
        if (typeof handlers.onError === "function") {
          handlers.onError(new Error(String(message)));
        }
      });

      socket.addEventListener("close", () => {
        if (typeof handlers.onClose === "function") {
          handlers.onClose();
        }
        if (!stopped) {
          scheduleReconnect();
        }
      });
    };

    connect();

    return () => {
      stopped = true;
      clearReconnect();
      if (socket && socket.readyState === this.WebSocketImpl.OPEN) {
        socket.close();
      } else if (socket && typeof socket.close === "function") {
        socket.close();
      }
    };
  }
}
